---
title: 'Your Pragmatism Needs a Healthy Dose of Idealism'
description: >-
  Pragmatism is frequently touted as the one way to write software. I'm not so sure that's right. Let's talk a bit about
  the spectrum of pragmatism and idealism.
date: 2020-03-11
author: Kyle Thompson
---

The other day I was having a conversation with Doug, a Staff Engineer on our team, about whether pragmatism and idealism
are at odds (when applied to writing software). He mentioned that he thinks it's more that they're on a spectrum than
being at odds against each other.

Essentially, the idea here is that on one end of this spectrum there is pragmatism. On that end, the approach taken is
realistic and more down-to-earth. Frequently, this surfaces itself as software that is "good enough." On the other end
of the spectrum there is idealism. On this end, the idea is to find, well, the ideal approach. By those definitions, the
spectrum is mostly about how _good_ the software should be. Pragmatism says "good enough" and idealism says "perfect."

This got me thinking a bit about how pragmatism affects the software we write. We'll dive into things a bit deeper, but
in short, I think people lean too far into pragmatism as their default and it comes at a big cost.

## The cost of pragmatism as the north star

Pragmatism as the sole and guiding principle in theory sounds good. Taking a realistic approach to software and building
good enough solutions will get your product out to market faster, but taken too far it can be detrimental to your
business.

### Lower quality solutions

One of the first things to go in a good enough solution (probably just after cutting feature scope) is the internal
quality of the solution. Rather than thoughtfully modifying the software to support a new use case, something quick is
bolted on. It's good enough, though, right? It works. It delivers business value. Sure, we've acquired a bit of
technical debt, but we'll go back and pay that off later.

Unfortunately, the pay-off phase of technical debt rarely comes and expectations are now set for a certain speed of
execution on new use cases. That decision to cut corners for the sake of pragmatism leads to more decisions to do the
same. This compounds over time, brings productivity to a grinding halt, and increases defects as edge cases are missed.

Soon, you'll find yourself in a place where a seemingly simple feature (compared to existing functionality) starts
getting estimates in the order of engineer-months as you realize you _have_ to massively change the system. You've been
backed into a corner and simply cannot deliver.

### Misalignment with the business

So, how did we get in this situation where it takes engineer-months to implement something "simple"? I'm of the opinion
that this is because our software is now fundamentally misaligned with the business. In this case, engineering rushed
to get something out the door without modifying the software to support the use case and now the software doesn't work
the way the business _thinks_ it works. Because of this misalignment, features that the business expects to be simple
(since they are just "how the business works") are not so simple anymore.

Once or twice, this probably doesn't matter, but when the decision is made time and time again, the choices pile up
until there is no way to dig yourself out (at least not easily).

## How much idealism is right?

None of this is to say, though, that you should lean too far on the idealism side. Waiting for perfect might mean that
your software never sees the light of day. Instead, decisions should be a careful cost/benefit analysis. To clarify,
we're not talking about "analysis paralysis" or "letting perfect be the enemy of good." What we're talking about is a
few days or a week to really dive in and understand the problem you're trying to solve.

### Known problem spaces

In businesses where you already know how it's supposed to work, this should be a no-brainer. Maybe you need to get to
market fast, but that little bit of analysis and discussion to truly understand your problem is _not_ going to kill the
business. Instead, those few days may just set it up for long-term success.

Keep in mind, though, that this analysis _doesn't_ mean that you have to build that perfect solution right now. You can
still launch with an MVP. Feel free to cut some features, but do so with an understanding of how things fit together in
the bigger picture. That way when you need to implement those features you haven't cornered yourself and you haven't
inadvertantly limited the business's options.

### Unknown problem spaces

On the other hand, maybe your business is brand-new, unexplored territory and you need some time to learn how it's
_supposed_ to work. In that case, sure you should probably build a good enough solution first. Once you have a better
understanding, though, take a long look at what you've built and consider realigning it to the problem-space. Take a bit
of time and build something that'll stand up to change because at the end of the day, the business _is_ going to change.
