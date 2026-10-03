# Product

## Summary

Moodboard is a visual board where people collect images, links, places, and notes, then agree on what to choose. The board starts as inspiration and ends as a decision: approved items, a budget, a checklist, and an exportable plan.

## Audiences

| Audience | Job to be done | Pays how |
|----------|----------------|----------|
| Wedding and event planners | Get clients to approve the look item by item | Business plan, monthly |
| Interior designers | Get clients to approve each room's products and track orders | Business plan, monthly |
| Couples planning their own wedding | Agree with a partner on every choice and stay in budget | Board Pass, one time |
| Households | Plan moves, house hunts, and dates over many years | Household plan, or a pass per board |
| One person | Collect inspiration from phone and laptop | Free |

Launch with planners. Personal workspaces follow once 10 or more planners pay.

## Problem

Planners juggle Pinterest boards, Canva decks, and email threads to get a client to say "yes, that one". The decision trail lives in email. Couples face the same mess between two people. Existing tools either collect inspiration (Pinterest, Milanote) or run the business (HoneyBook, Aisle Planner). None makes visual approval the core action.

## Positioning

- Against Pinterest, Milanote, and Notion: those are free and good at solo inspiration. Moodboard wins only when a board leads to a decision with someone else.
- Against HoneyBook and Aisle Planner: those cover contracts and payments. Moodboard covers the visual sign-off and links each item to its vendor.

## Pricing

| Plan | Price | Who | What it unlocks |
|------|-------|-----|-----------------|
| Free | $0 | Everyone | 2 active boards, 6 invited people per board, upload cap |
| Board Pass | $29 to $49 per board | Couples, one-off planners | Unlimited items and people on that board, export, larger uploads |
| Household | about $4 per month or $36 per year | Households with many boards | Passes on every household board |
| Business | $29 per month, 14-day trial | Planners, designers | Unlimited boards, clients, branding, PDF proposals |

Later revenue: affiliate links on vendor and product items, and paid vendor listings.

Out of scope: moving money between users. Cost splitting and payouts need Stripe Connect, identity checks, and dispute handling.

## Goal

35 paying business workspaces at $29 per month is about $1,000 in monthly recurring revenue. That is the proof point before investing in personal workspaces.

## Validation before building

1. Message 15 planners. Ask how clients approve the look today.
2. If 5 or more say it hurts, show a clickable mockup.
3. Ask 3 to pay for the first month before the product exists.
4. If nobody pays, change the idea before writing code.

## Risks

- Two audiences double marketing and support. Mitigation: planners first, personal growth through planner invites.
- Consumer churn after one event. Mitigation: one-time pass, household history across boards.
- Many retail sites block scrapers. Mitigation: Open Graph first, affiliate feeds later, a manual card when a preview fails.
- The builder works at an accessibility company. Do not build accessibility products. Check the employment agreement for side-project ownership.
