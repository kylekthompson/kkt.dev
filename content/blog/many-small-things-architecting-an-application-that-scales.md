---
title: 'Many Small Things: Architecting an Application That Scales'
description: >-
  A look at why tightly coupled applications with tall dependency graphs can't scale and how we can architect
  them in a way that avoids their pitfalls.
date: 2019-04-18
author: Kyle Thompson
---

Recently at work, I've had a lot of time to think about how we architect and design our server in a way that will scale
for our current needs and future ventures. While doing that, I feel like I keep coming back to a few guiding thoughts
that I'm planning on writing about.

In some applications, you'll find that to build new features or add functionality you build on top of other things. In
our application, one such stack of functionality is the process of buying a policy. At a high level, it looks like this:

1. Collect account information (email/password)
1. Collect profile information (address, license numbers, VINs, etc.)
1. Use that information to fetch reports from external services
1. Record the test drive
1. Use the profile information, reports, and driving data to figure out what to charge
1. Collect the customer's coverage preferences
1. Collect payment and finalize the policy

There's a lot of insurance-specific stuff in there, but you can probably see a few pieces- accounts, profiles, reports,
test drive, rating, quotes, and policies. Even ignoring the rest of our domain, you can see how things might get
unwieldy pretty quickly.

An initial attempt at modeling this might look something like this:

```ruby
class Policy < ApplicationRecord
  belongs_to :quote
end

class Quote < ApplicationRecord
  belongs_to :rate
  has_many :coverages
end

class Rate < ApplicationRecord
  belongs_to :profile
  has_many :premiums
  has_many :drivers, through: :profile
  has_many :driving_data, through: :drivers
  has_many :rate_reports
  has_many :reports, through: :rate_reports
end

class DrivingData < ApplicationRecord
  belongs_to :driver
end

class Report < ApplicationRecord
  belongs_to :profile
end

class Profile < ApplicationRecord
  belongs_to :account
  has_many :drivers
end
```

In this example, you can see below that each step in the process knows about the step before. Since it has that
knowledge and a hard dependency on it, we end up with a tall dependency graph.

```ruby {hl_lines=[2,6,11,20,24,28]}
class Policy < ApplicationRecord
  belongs_to :quote
end

class Quote < ApplicationRecord
  belongs_to :rate
  has_many :coverages
end

class Rate < ApplicationRecord
  belongs_to :profile
  has_many :premiums
  has_many :drivers, through: :profile
  has_many :driving_data, through: :drivers
  has_many :rate_reports
  has_many :reports, through: :rate_reports
end

class DrivingData < ApplicationRecord
  belongs_to :driver
end

class Report < ApplicationRecord
  belongs_to :profile
end

class Profile < ApplicationRecord
  belongs_to :account
  has_many :drivers
end
```

While we do have some small things at the bottom of the stack (like the profile and account), we also have a "really big
thing" at the very top of the stack.

## Why can't this scale?

In a lot of cases, this might not be a big deal (and we definitely should avoid overcomplicating the code if that is the
case). That being said, in a sufficiently complex domain like ours, we'll probably run into issues. While those issues
might not be directly related to having a "really big thing", having it tends to drive our application into an
undesirable state:

1. When one unrelated thing at the bottom changes, everything above it can break
1. Pieces at the top of the stack know about _everything_
1. New functionality can (for the most part) only scale vertically by adding to the top of the stack
1. Setting up tests becomes cumbersome and slow (to create a policy, we need everything below it)

For the purposes of this post, we're mostly going to look at points 1, 2, and 3. Testing will end up being an
afterthought of sorts, but it should naturally become easier with the solution we land on.

Before I get started, though, I think it will help to understand why I'm thinking about these problems.

## Why is this important to me?

At [Root](https://root.engineering/), I'm currently an engineer on two teams: Application Infrastructure (not quite what
it sounds like) and New Products/Product Variants.

At first read, those teams don't sound entirely related, but it might make more sense after hearing a bit about what
we do on those teams.

On the Application Infrastructure team, we're responsible for the overall architectural direction of our backend and
client codebases as well as developer productivity and the tools around that. On the New Products/ Product Variants
team, we're responsible for building out new products or varying our existing ones (aptly named, right?) and making sure
we can scale that while growing out both horizontally and vertically.

Insurance is an _extremely_ complex domain to work in so while "building out new products and varying existing ones"
might sound straight-forward, there are a ton of product and state-specific domain requirements that we need to build
out and maintain while we expand to every state. Given that background, it kinda makes sense to have a bit of overlap
between those teams since there will naturally be architectural concerns while trying to build out entire new offerings
or new flavors of existing ones.

Like any other complex system, we need to be pretty careful about how we write our code to make sure new engineers can
efficiently onboard and make meaningful contributions without understanding the entire application. Additionally, we
need to make sure that we aren't constraining ourselves so that our longer-tenured employees feel like they're able to
properly build their features.

Anyway- let's move on and find out how to scale our application.

## When tightly coupled pieces become a problem

At Root, we currently have two variants of car insurance. Let's call them "drive-first" and "drive-later." They are
more-or-less what they sound like. In drive-first, you'll download our app, sign up, take a test drive, get a quote
based on your test drive, and finally purchase a policy. In drive-later, the test drive step is _after_ you purchase
the policy- you'll start out with a policy and take a thirty-day test drive while already a policyholder. After that,
you'll get a final price based on your driving.

The example modeling that I laid out above can handle drive-first perfectly fine with a little extra code:

```ruby
module PolicyService
  def self.purchase(account:, quote:)
    pay_for(quote: quote)
    Policy.create!(...)
  end
end

module QuoteService
  def self.quote(account:, rate:, selections:)
    verify_coverage_selections(selections: selections)
    generate_quote_for(
      rate: rate,
      selections: selections
    )
  end
end

module RateService
  def self.rate(account:, profile:)
    reports = Reports.where(account: account)
    driving_data = DrivingData.where(account: account)

    rating_data = rating_data(
      profile: profile,
      reports: reports,
      driving_data: driving_data
    )
    premiums = calculate_premiums(rating_data: rating_data)

    create_rate(
      profile: profile,
      reports: reports,
      driving_data: driving_data,
      premiums: premiums
    )
  end
end

# etc.
```

Let's think a little about the differences between drive-first and drive-later, though:

- The **test drive** happens before the rate is created in drive-first but after the policy is purchased in drive-later
- 30 days after purchasing the policy in drive-later, the customer is **rerated** with the new driving data
- 60 days after purchasing the policy in drive-later, the policy is either **canceled or updated** to use the new rate
  with driving data

The last two differences are both additive, and the first is a change. As mentioned earlier, a tall dependency stack
makes it difficult and potentially risky to make a change to part of the stack. Because of that (and that additions are
generally easier to implement), we're going to focus the rest of this post on the first difference.

As written, we're going to have a really hard time supporting drive-later. We don't want to break drive-first, but
since all of the pieces are so tightly coupled, we're going to end up sweating through the night waiting for our
pagers to go off. Instead of dealing with that, let's write our code in a different way.

## How do we avoid the risks of tight coupling?

In an ideal system, we should be able to easily support changing existing functionality or adding new functionality. To
do that without fear of everything toppling over, we can re-think the structure of our code. Rather than building a big
and tall stack of code, we should try to build a lot of small pieces that we can compose together in a short stack.

### Small chunks of code with one purpose

Consider the previous process of purchasing a policy. I initially described it as a single process- from being some
anonymous person all the way to being a policyholder. Is that actually the case, though?

Earlier, we broke out some core ideas from the become-a-policyholder process: profiles, reports, test drive, rates,
quotes, and policies. When we initially talked about it, each thing built on top of the last.

But what if they didn't? What if they were distinct, separate small pieces of functionality? The profiles piece might
know how to store the profile information and provide that to anything that might need it. The reports piece might know
how to run external reports and persist them. And so on for the other pieces.

On their own, though, these smaller pieces are all pretty meaningless from a business perspective. You could almost go
as far as thinking of them as third-party services or libraries if you wanted to.

### Composing code into something meaningful

By itself, the "many small things" idea doesn't _quite_ work since there isn't a great way to define a whole business
process as many small things (it's a little contradictory if you think about it).

At some point, we need to take these small things, put some business logic around them, and define a more medium-sized
thing that provides some business value. You could imagine having multiple thin orchestration layers on top of those
small pieces.

In the earlier become-a-policyholder process, all of the logic was in one place and joined together. In a world of many
small things with thin orchestration layers on top, we might have a few distinct layers that all live independently of
one another: sign up, collect driving data, get a quote, and purchase a policy.

Each of these pieces might rely on some parts within the other, but the important part to note is that they don't rely
on everything. This distinction saves us from a number of the pitfalls I mentioned earlier.

Because we've already broken up a lot of our functionality into smaller pieces, these medium-sized business processes
that better define the stages of the business can now compose those smaller pieces into something that provides value.
And even better, if we want a new product variant, it's as simple as composing those pieces in a different way.

## Making our application scalable

Let's go back to the drive-first and drive-later product variants that we need to support and think through
re-designing the models and services that we have so far to open them up to change. We're going to walk through making
adjustments to the models and service layer to support purchasing a policy without taking a test drive in a
"many small things" way.

### Building many small, loosely-coupled models

Let's step back and look at our existing modeling of this process to refresh our memory:

```ruby
class Policy < ApplicationRecord
  belongs_to :quote
end

class Quote < ApplicationRecord
  belongs_to :rate
  has_many :coverages
end

class Rate < ApplicationRecord
  belongs_to :profile
  has_many :premiums
  has_many :drivers, through: :profile
  has_many :driving_data, through: :drivers
  has_many :rate_reports
  has_many :reports, through: :rate_reports
end

class DrivingData < ApplicationRecord
  belongs_to :driver
end

class Report < ApplicationRecord
  belongs_to :profile
end

class Profile < ApplicationRecord
  belongs_to :account
  has_many :drivers
end
```

#### Breaking dependencies between tightly-coupled models

To break up this tall stack, we'll start by breaking some dependencies (I've commented them out for clarity):

```ruby {hl_lines=[6,11,"13-16"]}
class Policy < ApplicationRecord
  belongs_to :quote
end

class Quote < ApplicationRecord
  # belongs_to :rate
  has_many :coverages
end

class Rate < ApplicationRecord
  # belongs_to :profile
  has_many :premiums
  # has_many :drivers, through: :profile
  # has_many :driving_data, through: :drivers
  # has_many :rate_reports
  # has_many :reports, through: :rate_reports
end

class DrivingData < ApplicationRecord
  belongs_to :driver
end

class Report < ApplicationRecord
  belongs_to :profile
end

class Profile < ApplicationRecord
  belongs_to :account
  has_many :drivers
end
```

You can see that I've removed the `belongs_to :rate` from the quote and the `belongs_to :profile` from the rate (as well
as a few other `has_many` relations). Let's talk about the _why_ of that, though.

Previously, the `Quote` and `Rate` had references to anything _that contributed to their creation_, but the thing is-
none of those records are really needed to create a quote or rate. A `Quote` is simply a subset of the premiums from the
rate. The rate is really only attached so we can for-sure say "this is how the quote was generated." Similarly, a `Rate`
is simply a set of premiums that we've calculated for some set of information (in this case, driving data, reports, and
the profile), and it only had references to the profile and other relations for auditability.

If that's truly the case, then why not model the auditing separately?

```ruby {hl_lines=["9-12","18-25"]}
class AuditQuote < ApplicationRecord
  belongs_to :quote
  belongs_to :rate
end

class AuditRate < ApplicationRecord
  belongs_to :rate
  belongs_to :profile
  has_many :drivers, through: :profile
  has_many :driving_data, through: :drivers
  has_many :rate_reports
  has_many :reports, through: :rate_reports
end
```

With this addition of a new `AuditRate` and `AuditQuote` (don't mind the naming 😅), we have a nice separation of
concerns and we've broken down the tall dependency graph into something shorter. With that, we have some nice benefits:

- We've set ourselves up to _generate rates and quotes in different ways_
- To create a policy, all we need is a quote with some premiums (so testing setup is a lot easier)
- Policy creation isn't dependent at all on how a rate is created so bottom-of-the-stack changes won't ripple up

#### Modeling product variants

To properly support drive-first and drive-later, various aspects of our system will need to know about what "variant" a
certain account is in. To handle that, we can introduce a new concept:

```ruby
class ProductVariant < ApplicationRecord
  belongs_to :account
end
```

This model is pretty small, but also pretty powerful. By pushing this low in the stack, the various orchestration layers
we talked about earlier can say "Hey, what kind of variant am I working with here? We'll want to create rating data for
that one." without depending on _everything_ in the system.

### Building many small, loosely-coupled services

On a similar note as the models, we also need a "many small things" approach with our services.

Earlier, we talked about the three main differences between drive-first and drive-later. The first one was about when
the test drive happened. For the most part, we're ready to support the change to when that happens. Recall our
`RateService` from earlier:

```ruby
module RateService
  def self.rate(account:, profile:)
    reports = Reports.where(account: account)
    driving_data = DrivingData.where(account: account)

    rating_data = rating_data(
      profile: profile,
      reports: reports,
      driving_data: driving_data
    )
    premiums = calculate_premiums(rating_data: rating_data)

    create_rate(
      profile: profile,
      reports: reports,
      driving_data: driving_data,
      premiums: premiums
    )
  end
end
```

Before making any changes, let's talk through the process of creating a rate:

1. Fetch some domain data
1. Use that data to build _rating_ data
1. Use that rating data to calculate premiums
1. Persist those premiums (and what we used to calculate them) as a "rate"

This service already acts more-or-less like an orchestration layer when broken down into steps like this, but the main
issue is that it's only orchestrating itself. Because of that, all of the logic lives within this one really big
service, so it isn't really open for change.

The main things that are "locking it down" from my perspective are:

- The hard dependency on using the driving data to build rating data
- Rate creation requires a profile, reports, and driving data

```ruby {hl_lines=["3-4","6-10"]}
module RateService
  def self.rate(account:, profile:)
    reports = Reports.where(account: account)
    driving_data = DrivingData.where(account: account)

    rating_data = rating_data(
      profile: profile,
      reports: reports,
      driving_data: driving_data
    )
    premiums = calculate_premiums(rating_data: rating_data)

    create_rate(
      profile: profile,
      reports: reports,
      driving_data: driving_data,
      premiums: premiums
    )
  end
end
```

With that in mind, let's try to break out a few smaller things from this big service:

```ruby
module RatePremiumService
  def self.calculate_premiums(rating_data:)
    # super-secret premium calculation code here
  end
end

module DriveFirstRatingDataService
  def self.build(account:, profile:)
    reports = Reports.where(account: account)
    driving_data = DrivingData.where(account: account)

    # super-secret rating data creation process
    # with the profile, reports, and driving data
  end
end

module RateService
  def self.rate!(product_variant:, account:, profile:)
    rating_data = rating_data_service_for(variant: product_variant).build(
      account: account,
      profile: profile
    )
    premiums = RatePremiumService.calculate_premiums(rating_data: rating_data)
    Rate.create!(account: account, premiums: premiums)
  end
end
```

So, what has changed?

- We are taking a new dependency on the `ProductVariant` that we modeled earlier
- We split out the `build_rating_data` method to a new service responsible only for that
- From that product variant, we can choose the correct rating data service
- `RateService` now only composes other smaller pieces

At the end of the day, `RateService` looks pretty similar. It encapsulates and orchestrates the process of creating a
rate, but it does so while allowing the previously defined business rules to change based on the product variant. All of
the "steps" to create a rate end up well-defined, so when we want to test out a new product variant, it's
straightforward to do what we need- define a new rating data service that can build rating data for that specific
variant.

### Building and composing a new small thing

Now that we've done the upfront work to break down our "really big thing" into "many small things", let's make good use
of that by adding support for our drive-later product variant. Previously, we defined a single
`DriveFirstRatingDataService` to keep the functionality on-par with the old `RateService`, but let's go ahead and extend
that to drive-later now:

```ruby
module DriveLaterRatingDataService
  def self.build(account:, profile:)
    reports = Reports.where(account: account)

    # super-secret rating data creation process
    # with the profile and reports
  end
end
```

You can see here that we now have two rating data services to go along with our two product variants. The `RateService`
is still in charge of creating rates, but we've opened it up for extension by providing a way to build rating data in
whatever way a product variant requires.

Since we have rating data set up in this way, you could imagine what creating new product variants might look like in
the future. For example, consider a product variant where we priced a customer based on how often their puppy barked:

```ruby
module PuppyBarkRatingDataService
  def self.build(account:, profile:)
    reports = Report.where(account: account)
    barks = Bark.from_puppies.where(profile: profile)

    # super-secret rating data creation process
    # with the profile, reports, and barks
  end
end
```

## Wrapping up

So, we've gone from a very tall stack of code ready to fall over with any change into something that allows us to swap
out or compose other small pieces. We can build drive-first, drive-later, and any other variant of auto insurance that
we want to without breaking an existing variant.

Hopefully, you're able to see some of the benefits of composing a lot of small pieces over a single tall stack of code.
At Root, I think this approach is going to let us iterate quickly, write fast, meaningful tests, and provide a ton of
business value without keeping us awake at night.

_I'd also like to give a shout-out to Bob Carson, Emily Engle, and Tony Schneider for their suggestions and help in
editing this post ✨_
