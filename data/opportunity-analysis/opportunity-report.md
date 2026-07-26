# Dogist Local Opportunity Analysis

Generated: 2026-06-25T00:42:43.141Z
Input: `undefined`

## Corpus

- Posts analyzed: 370
- Comments analyzed: 97,579
- Unique commenters: 49,478
- High-signal comments: 15,557
- Generic/short comments: 17,340
- Median comment likes: 0

## Method In Plain English

What was done:

1. Start from the processed Dogist export with post captions, post links, comment text, authors, and comment likes.
2. Run a topic model across all tokenizable comments to see the broad shape of the conversation.
3. Score comments for business signal using length, questions, first-person experience, likes, and domain terms.
4. Run a second topic model on that high-signal subset so generic praise does not bury product, care, rescue, or service language.
5. Cross-tab comment topics with post formats so the unit of analysis is not just a topic, but a topic inside a kind of post.
6. Build compact evidence packets for Claude to interpret.

Why this shape:

- The corpus is too large and repetitive to send raw to Claude.
- A topic model helps reveal structure without manually reading thousands of comments.
- The local pass is intentionally a reduction step, not the final interpretation.
- Manual reading here should stay light: spot-check for false positives, then let Claude interpret reduced packets.

How to read a topic:

- `label_terms` are the strongest TF-IDF terms near the cluster center, not a human-written label.
- `representative_comments` are examples near the cluster center, not proof by themselves.
- Treat high counts as "worth asking Claude about," not validated demand.

Important context boundary:

- The topic models are corpus-derived: they come from the scraped comments.
- The business opportunity buckets are hypothesis-driven: they use Zach's meeting context as a lens.
- The blueberry/supplement launch is not an organic conclusion from the topic model by itself. The corpus does contain organic blueberry, food, treat, recipe, and picky-eater comments, but connecting that to a supplement launch is an interpretation step.
- Claude should run both a context-free read and a business-context read before Zach treats any claim as useful.

## Early Business Signals

### Food, Treats, And Product Trust

- Status: candidate / needs validation
- Breadth: 266 posts, 3,735 matched comments, 3,255 high-signal comments
- Comment likes on matched comments: 11,396
- Working read: Healthy pet products need to feel dog-approved, safe, and emotionally rewarding rather than medicinal.
- Next validation post: What healthy treat does your dog actually refuse, even when you want them to like it?
- Example: "All my dogs have had different food changing over their lives as some issue or another came up I had a Dalmatian who had such a severe corn allergy that he was dying Once his intestines healed it was hard to find no corn dog kibble other than lamb and rice whi"

### Rescue And Adoption Trust

- Status: candidate / needs validation
- Breadth: 271 posts, 2,524 matched comments, 2,139 high-signal comments
- Comment likes on matched comments: 13,336
- Working read: Rescue/adoption may be less about immediate commerce and more about brand affinity and partner credibility.
- Next validation post: What made you trust the rescue or shelter you adopted from?
- Example: "Also if you are a senior who may not want a very active dog or worry about the time span limited years you may have a senior is a perfect fit I started a program at our shelter called Seniors for Seniors half price adoption fees for any dog over 7 being adopte" (625 likes)

### IRL Community And Sampling

- Status: candidate / needs validation
- Breadth: 316 posts, 2,179 matched comments, 1,736 high-signal comments
- Comment likes on matched comments: 6,837
- Working read: If the audience asks Dogist to show up in places, IRL sampling may be a stronger first test than broad e-commerce.
- Next validation post: Where should The Dogist host a walk and what treat should every dog get?
- Example: "I wish that poor Knicks dog could be here but because of some trigger happy LAPD cops Jameson cannot Can we honor him in nyc and get some momentum going so this never happens again to another family" (237 likes)

### Grief, Loss, And Memorial Language

- Status: candidate / needs validation
- Breadth: 275 posts, 1,908 matched comments, 1,632 high-signal comments
- Comment likes on matched comments: 8,116
- Working read: Grief posts can reveal very high trust and emotional intensity, but they should not be treated as product demand by default.
- Next validation post: What helped you remember your dog in a way that felt personal?
- Example: "She s beautiful When my Pomeranian Lucy went blind I took out my dining room table and made everything easier for her to get around She crossed the rainbow bridge almost a year ago at 17 Miss my bossy little girl" (190 likes)

### Senior, Health, And Care Companionship

- Status: candidate / needs validation
- Breadth: 185 posts, 1,334 matched comments, 1,216 high-signal comments
- Comment likes on matched comments: 11,259
- Working read: The strongest wellness language may be about owner care, adaptation, and companionship, not clinical optimization.
- Next validation post: What is one care routine that changed as your dog got older?
- Example: "I m not sure how long they ve been doing this in the states but they just started doing this around 2020 when I started vet nursing in Newcastle Australia at least in the clinics I worked in Was cool to see them start doing it I grew up with a cat that was dia" (1240 likes)

### Services, Cost, And Access Pain Points

- Status: candidate / needs validation
- Breadth: 208 posts, 856 matched comments, 766 high-signal comments
- Comment likes on matched comments: 3,086
- Working read: Organic service/cost mentions are likely undercounted; strong conclusions require targeted posts.
- Next validation post: Have you tried pet insurance, and what made you keep it or cancel it?
- Example: "again I must correct because you are spreading misinformation A lot of people still believe what you say here but the evidence is clear and the American Veterinary Society for Behavioural Science the national authority on dog training and behavioural issues sa" (414 likes)

### Product, Commerce, And Merch Pull

- Status: weak / noisy heuristic / needs Claude cleanup
- Breadth: 230 posts, 853 matched comments, 759 high-signal comments
- Comment likes on matched comments: 1,485
- Working read: Explicit buying language is sparse but high value; separate it from general affection before using Claude.
- Next validation post: What Dogist product would you actually buy for yourself or your dog?
- Example: "I am nominating the nonprofit Treats for Pups aka on IG For the category of Canine Health and Wellness This incredible organization created by Pina De Rosa is a very unique special organization in memory of her late beloved pup Wellington continues on with the"

### Behavior, Anxiety, And Training

- Status: candidate / needs validation
- Breadth: 186 posts, 751 matched comments, 651 high-signal comments
- Comment likes on matched comments: 3,627
- Working read: Behavior comments can point to real owner stress and service demand, not just cute-story engagement.
- Next validation post: What behavior issue did you finally understand after living with your dog?
- Example: "AVSAB vets who specialize in behavioral problems aka the literal experts put out a position statement that they do not recommend ecollars prongs etc for any dog but especially not for reactive or aggressive dogs A dog who wants to attack you will not be even s" (1 likes)

## Post Format Distribution

- Food, treats, and recipes: 79 posts, 19,298 comments, 4,263 high-signal comments
- Rescue and adoption stories: 76 posts, 21,516 comments, 3,465 high-signal comments
- IRL community, walks, and events: 101 posts, 25,694 comments, 3,170 high-signal comments
- Loss, grief, and memorial stories: 35 posts, 10,334 comments, 1,715 high-signal comments
- Services, cost, and owner logistics: 39 posts, 12,325 comments, 1,592 high-signal comments
- Health, senior, and care stories: 24 posts, 6,615 comments, 1,172 high-signal comments
- Products, gear, and commerce: 9 posts, 1,713 comments, 168 high-signal comments
- General portrait or story posts: 7 posts, 84 comments, 12 high-signal comments

## Strongest Cross-Tabs

- Food, treats, and recipes x Food, Treats, And Product Trust: 2,556 high-signal comments across 78 posts
- Rescue and adoption stories x Rescue And Adoption Trust: 1,292 high-signal comments across 76 posts
- IRL community, walks, and events x IRL Community And Sampling: 782 high-signal comments across 98 posts
- Loss, grief, and memorial stories x Grief, Loss, And Memorial Language: 576 high-signal comments across 35 posts
- Health, senior, and care stories x Senior, Health, And Care Companionship: 477 high-signal comments across 24 posts
- Rescue and adoption stories x Grief, Loss, And Memorial Language: 369 high-signal comments across 58 posts
- IRL community, walks, and events x Travel And Dog-Friendly Places: 309 high-signal comments across 73 posts
- Rescue and adoption stories x IRL Community And Sampling: 297 high-signal comments across 64 posts
- Food, treats, and recipes x Senior, Health, And Care Companionship: 270 high-signal comments across 36 posts
- Services, cost, and owner logistics x Services, Cost, And Access Pain Points: 252 high-signal comments across 32 posts
- IRL community, walks, and events x Rescue And Adoption Trust: 250 high-signal comments across 69 posts
- Services, cost, and owner logistics x Behavior, Anxiety, And Training: 245 high-signal comments across 34 posts

## All-Comment Topic Model

Modeled 57,768 comments after tokenization from 97,579 total comments.

- all_comments_topic_01: beautiful, best, boy, adorable, handsome - 8,317 comments, 696 high-signal
- all_comments_topic_21: hope, happy, years, two, new - 5,313 comments, 1,869 high-signal
- all_comments_topic_23: love, omg, beautiful, best, great - 5,223 comments, 1,187 high-signal
- all_comments_topic_11: beagle, husky, named, mix, back - 4,398 comments, 978 high-signal
- all_comments_topic_17: baby, eat, loves, food, carrots - 3,279 comments, 1,742 high-signal
- all_comments_topic_02: day, every, know, time, made - 2,831 comments, 1,145 high-signal
- all_comments_topic_08: amazing, rescue, work, thought, first - 2,738 comments, 990 high-signal
- all_comments_topic_19: please, need, come, meet, nice - 2,716 comments, 1,258 high-signal
- all_comments_topic_12: sweet, girl, pretty, face, beautiful - 2,461 comments, 380 high-signal
- all_comments_topic_13: life, better, world, joy, living - 2,405 comments, 885 high-signal

## High-Signal Topic Model

Modeled 15,054 comments from 15,557 high-signal comments.

- high_signal_topic_01: rescue, need, thank, miss, amazing - 2,895 comments across 337 posts
- high_signal_topic_09: love, beautiful, rescue, people, thank - 1,274 comments across 303 posts
- high_signal_topic_10: food, chicken, kibble, use, vet - 1,158 comments across 180 posts
- high_signal_topic_13: eat, blueberries, loves, eats, carrots - 1,144 comments across 111 posts
- high_signal_topic_14: know, old, time, year, years - 1,094 comments across 275 posts
- high_signal_topic_18: life, happy, birthday, way, changed - 998 comments across 241 posts
- high_signal_topic_16: best, ever, love, friend, rescue - 799 comments across 238 posts
- high_signal_topic_06: day, every, treats, single, time - 794 comments across 231 posts
- high_signal_topic_04: take, care, someone, people, let - 738 comments across 239 posts
- high_signal_topic_08: please, come, visit, need, help - 631 comments across 236 posts

## Claude-Ready Files

- `data/opportunity-analysis/corpus-summary.json`
- `data/opportunity-analysis/post-clusters.json`
- `data/opportunity-analysis/comment-topics.json`
- `data/opportunity-analysis/comment-topic-model.json`
- `data/opportunity-analysis/opportunity-candidates.json`
- `data/opportunity-analysis/claude-evidence-packets.json`
- `data/opportunity-analysis/opportunity-report.md`

## Caution

These are local reduction outputs, not validated product findings. Treat high counts as places to inspect and validate, especially because broad Dogist affection can overwhelm business signal.

## Topic Term Snapshots

### Food, Treats, And Product Trust

Terms: eat (711), food (711), treats (385), love (363), blueberries (353), chicken (275), carrots (261), treat (239), loves (237), veggies (221)

Phrases: green beans (92), sweet potato (80), sweet potatoes (72), eat anything (67), home cooked (64), brown rice (59), fruits veggies (59), ground turkey (58)

### Rescue And Adoption Trust

Terms: rescue (784), love (442), adopted (398), rescued (258), shelter (226), best (220), life (202), years (201), foster (184), thank (174)

Phrases: pit bulls (65), years ago (65), happy birthday (48), forever home (42), every day (38), foster fail (36), year old (35), years old (30)

### IRL Community And Sampling

Terms: meet (654), come (327), love (304), nyc (258), visit (183), city (180), day (113), new (113), best (91), need (91)

Phrases: new york (96), love meet (56), please come (37), meet dogist (30), central park (29), come visit (26), hope meet (25), happy birthday (22)

### Grief, Loss, And Memorial Language

Terms: miss (451), lost (286), love (266), passed (229), years (190), best (158), life (150), crying (141), day (139), cry (117)

Phrases: passed away (68), every day (55), sorry loss (52), years ago (39), year old (34), happy birthday (30), rainbow bridge (30), last year (29)

### Senior, Health, And Care Companionship

Terms: vet (235), years (208), love (206), senior (187), cancer (165), life (146), blind (144), best (136), old (119), care (117)

Phrases: take care (47), breast cancer (46), year old (46), every day (44), went blind (43), years ago (43), years old (34), home cooked (24)

### Services, Cost, And Access Pain Points

Terms: walking (150), love (123), training (122), service (112), every (84), day (68), people (58), best (57), sitting (57), time (57)

Phrases: every day (22), happy birthday (19), every weeks (14), pet insurance (13), home cooked (12), vet bills (11), groomer every (10), prong collar (10)

