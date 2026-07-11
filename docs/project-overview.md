# Chiron Project Overview

## Summary

Chiron is an AI-first, streamlined event discovery and event publishing platform for community programs. It is designed for people who do not want to wrestle with a large calendar, complex filters, or scattered nonprofit websites just to find something useful to attend.

Instead of starting with a dense event directory, Chiron starts with a simple conversation. A user describes what they want in plain language, and Chiron helps them either find a relevant event or create a new event listing. After the initial conversation, the app presents a focused event list and calendar view based on the user's needs.

The larger vision is a lightweight community information network: nonprofits can publish events with minimal friction, and community members can receive recommendations through channels they already use, including web chat, WhatsApp, and email.

## Problem

Community events and programs are often spread across many nonprofit websites, calendars, PDFs, newsletters, and registration systems. Even when a shared calendar exists, it can be overwhelming, visually cluttered, difficult to navigate, and inaccessible for people with different needs.

The challenge is not only to display events better. The deeper challenge is to help people discover the right opportunities in a form they can understand and use, while also making it easy enough for nonprofit staff to keep event information current.

Chiron is built around this product question:

> How can nonprofits contribute event information with almost no friction, while each community member receives a small, understandable set of relevant opportunities through a channel they can actually use?

## Target Users

Chiron serves two connected groups:

1. Community members looking for programs, services, or events.
2. Nonprofit staff who need to publish and maintain event information.

For community members, Chiron reduces the burden of search. Users should not need to know the exact name of a program, understand nonprofit category labels, or scroll through dozens of listings. They can say something like, "I want something free to do with my son this Saturday near downtown," and Chiron can translate that need into useful recommendations.

For nonprofit staff, Chiron reduces the burden of publishing. Staff should be able to create or update event listings quickly, ideally by reusing existing materials such as flyers, calendar entries, recurring event templates, or short descriptions they already have.

## Core Experience

### 1. Conversational Entry Point

When a user arrives, they are greeted by a chatbot. The chatbot asks what the user wants to do:

- Find an event or program to attend.
- Create or publish an event.

The user can respond naturally instead of filling out a long form. Chiron interprets the user's intent and guides them into the right flow.

### 2. Event Discovery Flow

For people looking for events, Chiron asks a few simple questions, such as:

- What are you looking for?
- Who is this for?
- When are you available?
- How far can you travel?
- Does it need to be free?
- Do you need any accessibility accommodations?

Rather than returning every matching result, Chiron should return a manageable set of strong matches. The goal is to reduce cognitive load by showing a few relevant options first, with the ability to expand into the full event list or calendar if needed.

After the conversation, the user sees:

- A short list of recommended events.
- A calendar view for browsing by date.
- Plain-language event summaries.
- Key details such as location, cost, time, accessibility accommodations, and registration method.

### 3. Event Creation Flow

For nonprofit staff, Chiron supports a guided event creation flow. Staff can describe an event in plain language or provide existing material, such as a flyer or copied event description. Chiron helps convert that input into a structured listing.

Each listing should include:

- Event title.
- Plain-language summary.
- Date and time.
- Location or online access details.
- Cost.
- Intended audience or age group.
- Accessibility accommodations.
- Transportation notes, if available.
- Registration instructions or external registration link.
- Hosting organization.

The nonprofit reviews the generated listing before publishing. This keeps the experience fast while still giving staff control over accuracy.

## Boardy-Like Recommendation Layer

Chiron also includes a proactive recommendation layer inspired by a "Boardy-like" experience. Users can describe who they are and what they are looking for through familiar channels such as WhatsApp or email.

For example, a user could message:

> I am looking for low-cost weekend activities for my teenager. We live near Kitchener and prefer events that are not too loud.

Chiron can use that profile to recommend relevant events over time. Instead of requiring the user to repeatedly search the website, Chiron can send:

- Weekly email digests.
- WhatsApp recommendations.
- Event reminders.
- Updates when a matching new event is published.

This makes discovery less dependent on the user remembering to visit a website. It also supports people who are more comfortable with messaging than with navigating a full event platform.

## Accessibility Approach

Chiron should not treat accessibility as a single generic mode. Different users need different kinds of support.

For users with low literacy, Chiron should provide:

- Plain-language summaries.
- Short sentences.
- Icons paired with text.
- Audio-friendly event descriptions.
- Fewer choices per screen.

For screen-reader users, Chiron should provide:

- Semantic page structure.
- Meaningful headings and labels.
- Keyboard navigation.
- Clear focus states.
- No dependence on color alone.

For users with intellectual or cognitive disabilities, Chiron should provide:

- Predictable step-by-step flows.
- Concrete wording.
- Clear confirmation before actions.
- Small sets of choices.
- Consistent layouts.

The product goal is not to create one "accessible calendar." The goal is to create a discovery experience that can adapt to different abilities, preferences, and communication channels.

## Why Chiron Is More Than a Calendar

A normal calendar assumes that users know what they are looking for, know how to search, and can handle a large number of results. Chiron starts from a different assumption: many people only know their situation or need.

Chiron translates human needs into event matches. It combines:

- Conversational intake.
- AI-assisted event understanding.
- Plain-language summaries.
- Personalized recommendations.
- Calendar and list views.
- Email and WhatsApp delivery.
- Low-friction nonprofit publishing.

The result is not just an event database. It is a simpler information loop between nonprofits and the community.

## Nonprofit Value

For Chiron to succeed, nonprofits need a practical reason to contribute. The platform should save time, reduce duplication, and make events easier to promote.

Possible nonprofit benefits include:

- Create one event listing and distribute it across web, email, and WhatsApp.
- Upload a flyer and have Chiron draft the listing automatically.
- Reuse templates for recurring events.
- Generate plain-language summaries from longer descriptions.
- Maintain consistent event details without replacing existing registration systems.
- See basic engagement signals, such as views, saves, and recommendation clicks.
- Reduce repetitive questions from community members.

Chiron should centralize discovery, not force every nonprofit to abandon its existing registration workflow.

## Prototype Scope

The first prototype should demonstrate the core loop:

1. A community member chats with Chiron and describes what they need.
2. Chiron asks a few clarifying questions.
3. Chiron recommends a small set of relevant events.
4. The user can browse the resulting event list and calendar.
5. A nonprofit staff member creates an event through a guided AI-assisted flow.
6. The event becomes available for recommendations.
7. A user can opt into email or WhatsApp updates for future matching events.

This scope is enough to show the main product idea without needing to build every production feature.

## Product Principles

- Start with the user's need, not the event database.
- Show fewer, better recommendations before showing a full calendar.
- Make event publishing fast enough that nonprofits will actually use it.
- Keep registration flexible by linking out to each nonprofit's existing process.
- Treat accessibility as part of the core product, not a visual theme.
- Support channels people already use, including email and WhatsApp.
- Use AI to simplify and route information, while keeping humans in control of published event details.

## One-Sentence Pitch

Chiron is an AI-first community event assistant that helps people find relevant local programs through chat, calendar, email, and WhatsApp, while giving nonprofits a fast way to turn scattered event information into accessible listings.
