---
title: "Root's Migration from In-Process Pub/Sub to Kafka"
description: >-
  An overview of how we migrated from an in-process pub/sub to out-of-process pub/sub with Kafka.
date: 2019-09-22
author: Kyle Thompson
---

For a long time at [Root](https://root.engineering/), we've used pub/sub as a way to decouple
parts of our application. This was done with a small ruby class. Essentially, you'd call `publish` with an event and
the associated attributes, and any subscribers would run inline at that moment.

That has worked very well for us, but we wanted to have the option to eventually extract some "macroservices" from our
monolith. To make that extraction work, our current pub/sub solution wouldn't quite cut it (since it needs to be able to
call the subscribers directly).

After some investigation into our options (AWS SQS/SNS, AWS Kinesis, RabbitMQ, Redis Pub/Sub, and Kafka), we landed on
Kafka as the successor to our in-process solution. In this post, I'm going to dive into what our existing solution
looked like, and how we migrated to Kafka without any downtime.

**Note**: I _have_ simplified this example a little. In our application we actually have multiple instances of the
`PubSub` class I show below (and therefore multiple topics). For the sake of this overview, we'll use only one.

## Our in-process pub/sub implementation

Let's start this off with some code. This is a small example of how you might use our in-process pub/sub:

```ruby
# engines/profiles/config/initializers/pub_sub.rb

PubSub.default.register(:profile_updated, attributes: %i[account_id profile_id])

# engines/profiles/app/services/profile_service.rb

module ProfileService
  def self.update(account_id:, profile_attributes:)
    # ...
    PubSub.default.publish(:profile_updated, account_id: account_id, profile_id: profile_id)
  end
end

# engines/rating/config/initializers/pub_sub.rb

PubSub.default.subscribe(:profile_updated) do |account_id:, profile_id:|
  RateJob.perform_later(account_id: account_id, profile_id: profile_id)
end
```

In this example, we have an instance of `PubSub` with one event (`:profile_updated`) that takes `account_id` and
`profile_id` as attributes. Once the profile is updated in the `ProfileService`, `:profile_updated` is published to
`PubSub.default`. Finally, `RateJob` is subscribed to the `:profile_updated` event in the `rating` engine.

One minor thing to note here is the use of "engines." For a little more information on how we have structured our Rails
application, check out [our CTO's blog post about the modular monolith.](https://medium.com/@dan_manges/the-modular-monolith-rails-architecture-fb1023826fc4/)

Anyway, a slimmed down implementation of the `PubSub` class looks roughly like this:

```ruby
class PubSub
  Event = Struct.new(:name, :attributes, :subscribers)

  def self.default
    @default ||= new
  end

  def initialize
    @events = {}
  end

  def register(event_name, attributes:)
    event = Event.new(event_name, attributes, [])
    events[event_name] = event
  end

  def publish(event_name, attributes = {})
    event = events.fetch(event_name)
    raise "invalid event" unless attributes.keys.to_set == event.attributes.to_set

    event.subscribers.each do |subscriber|
      subscriber.call(attributes)
    end
  end

  def subscribe(event_name, &block)
    event = events.fetch(event_name)
    raise "invalid subscriber" unless block.parameters.all? { |type, _name| type == "keyreq" }
    raise "invalid subscriber" unless block.parameters.map { |_type, name| name }.to_set == event.attributes.to_set

    event.subscribers << block
  end

  private

  attr_reader :events
end
```

As mentioned earlier, when we "publish" an event all of the subscribers are executed inline.

## Our migration to Kafka

Within our system, we have a good amount of business critical functionality running through our pub/sub setup. Up to
this point, that wasn't a point of concern as it was just another piece of code executing. Moving to Kafka introduces
another point of failure with a distributed system, so we had to de-risk our migration. To do so, we gathered data and
took an incremental approach in cutting over.

### Gathering analytics

To fully understand the load we would be putting on this new system, we started by gathering data on our current usage
of pub/sub. Primarily, we were interested (at this point) in how many messages per second we were consuming per
anticipated topic.

To get these metrics, we instrumented the existing pub/sub code with counts through StatsD.

```ruby
class PubSub
  # ...

  def publish(event_name, attributes = {})
    statsd.increment("pub_sub.#{name}.#{event_name}.published")

    # ...
  end

  # ...
end
```

We used these metrics to do some capacity planning for our Kafka cluster before implementing and cutting over.

### Publishing and consuming messages (no-op)

We didn't want to jump right into publishing and consuming pub/sub through Kafka (even with our analytics). Since we
hadn't run a Kafka cluster in production yet, we wanted to be sure we understood how it would behave. To get ourselves
more comfortable with it, we started with consumers that would no-op and simply mark messages as consumed:

```ruby
class Consumer < Karafka::BaseConsumer
  def consume(out: $stdout)
    params_batch.each do |params|
      out.puts "TOPIC: #{params.fetch("topic")}"
      out.puts "EVENT: #{params.fetch("event")}"
    end
  end
end
```

Since the consumers weren't doing any work, we also had to support publishing to both Kafka and our inline subscribers
at the same time. To do this, we introduced publish adapters into our `PubSub` class. Doing this provided us the ability
to compose adapters (a `MultiAdapter` that ran both the `Inline` and `Kafka` adapters) as well as override the adapter
to `Inline` in our tests.

```ruby
class PubSub
  module Adapters
    class Inline
      def publish(pub_sub, event, attributes)
        pub_sub.consume(event.name, attributes)
      end
    end
  end
end

class PubSub
  module Adapters
    class Kafka
      def initialize(producer: WaterDrop::SyncProducer)
        @producer = producer
      end

      def publish(pub_sub, event, attributes)
        producer.call(
          {
            :event => {
              :name => event.name,
              :attributes => attributes
            }
          }.to_json,
          :partition_key => pub_sub.partition_key(attributes),
          :topic => pub_sub.topic
        )
      end

      private

      attr_reader :producer
    end
  end
end
```

As one final bit of precaution, we also set the Kafka publisher up to have a chance-based publish (not shown here) to
limit throughput (adjustable through an environment variable) and started publishing only in our background workers.
After slowly scaling up to 100% publish chance in background workers and getting a good idea of the differences in
timing to publish, we turned publishing to Kafka on in the web workers (again, slowly scaling up the publish chance).

### Cutting over fully to publishing and consuming in Kafka

After letting the no-op implementation settle, we included additional metadata in our messages to Kafka to indicate
whether the consumer should process the message and updated the consumer to consume the message based on. This value
was controlled through an environment variable, so we could switch between in-process pub/sub and Kafka if necessary:

```ruby {hl_lines=[10]}
class PubSub
  module Adapters
    class Kafka
      # ...

      def publish(pub_sub, event, attributes)
        producer.call(
          {
            :event => {
              :should_consume => ENV["CONSUME_MESSAGES_THROUGH_KAFKA"] == "true",
              :name => event.name,
              :attributes => attributes
            }
          }.to_json,
          :partition_key => pub_sub.partition_key(attributes),
          :topic => pub_sub.topic
        )
      end

      # ...
    end
  end
end
```

Now that we were confident in publishing and consuming, we were able to cutover the environment variable to consume
messages in our Kafka consumers. When this environment variable was changed, we stopped publishing to the inline
subscribers and were only publishing to Kafka.

```ruby {hl_lines=[6]}
class Consumer < Karafka::BaseConsumer
  def consume(pub_sub: nil)
    pub_sub ||= PubSub.default

    params_batch.each do |params|
      next unless params["should_consume"]

      topic = params.fetch("topic")
      event = params.fetch("event")

      pub_sub.consume(
        event.fetch("name").to_sym,
        event.fetch("attributes").deep_symbolize_keys
      )
    end
  end
end
```

## Unexpected issues found once we cut over

Like any big launch of an new system, you might run into some unexpected problems. So far, we've run into one problem
worth mentioning.

On the first weekend after we cut over to Kafka, we ran into a series of cascading issues:

- We had large influx of failed jobs
- Clearing those caused a Redis slowdown
- The Redis slowdown sufficiently slowed our consumers such that they fell behind
- Our paging infrastructure failed to alert us of this early on

The fallout of this was that we were so severely behind in processing that the consumers were not able to process a full
batch of messages before the session timeout. Because of that, the consumers would miss their heartbeats and be kicked
out of the consumer group. Each time that happened, a rebalance occurred further slowing down processing.

There is a good overview of this issue and a hacky way to resolve it [in this GitHub comment.](https://github.com/zendesk/ruby-kafka/issues/561#issuecomment-393309692)
To solve the issue going forward, we implemented microbatches with a manual heartbeat after each in our consumer as
suggested by the linked comment.

## Annnd we're done!

All in all, we had a fairly seamless migration. The one issue mentioned above was a topic with very low importance, so
we're chalking it up to a learning experience that will prevent issues in the future on our more important topics. Kafka
has now been running our pub/sub in production for about four weeks without any significant issues (knock on wood!).
