# EDGAR Radar, explained simply

*A plain-English guide for anyone, no technical background needed.*

---

## The one-sentence version

EDGAR Radar is a system that **automatically watches the official reports that big US companies file with the government, pulls out the important numbers, checks those numbers for warning signs, and notices when a company changes what it warns investors about.** It runs by itself, around the clock, for free.

---

## The problem it solves

Every public company in the United States must regularly publish reports about its finances: how much money it made, how much it owes, what risks it faces. These reports go to a government agency called the **SEC** (Securities and Exchange Commission), which puts them all on a public website called **EDGAR**.

That information is free, but it's hard to use:

- **There's a flood of it.** Large companies file something almost every business day, and a single annual report can be hundreds of pages long.
- **The numbers are buried.** Finding "how much debt does this company have?" means digging through long documents.
- **Changes are easy to miss.** When a company quietly adds a new warning to its annual report, such as a new lawsuit or a new dependence on one supplier, nobody points it out.
- **Warning signs take expertise to spot.** Accountants use well-known formulas to judge whether a company is financially healthy, but most people don't know them.

EDGAR Radar does that reading, calculating and comparing automatically.

---

## What it actually does

Think of it as a very diligent assistant who never sleeps.

### 1. It keeps watch
Every **30 minutes**, EDGAR Radar checks **196 large, well-known US companies** (Apple, Microsoft, JPMorgan Chase, Tesla and others) for anything new they've filed with the SEC. On a normal weekday it spots dozens of new filings.

### 2. It pulls out the numbers
When something new appears, it collects the company's key financial figures, such as revenue, profit, debt and cash, and stores them neatly so they're easy to look up and compare over the years.

### 3. It double-checks its own work
Numbers from the real world are sometimes messy or wrong. The system checks every figure before trusting it: a value that isn't a real number, is impossibly large, or carries an invalid date is set aside for review instead of being used. **Every night**, it also compares everything it has stored against the SEC's complete official records, to make sure nothing was missed or went out of date.

### 4. It scores each company's financial health
It calculates three well-established scores that financial analysts have used for decades:

| Score | The question it answers |
|---|---|
| **Altman Z-Score** | *Does this company look like one at risk of going bankrupt?* |
| **Piotroski F-Score** | *Is this company's financial strength improving or getting worse?* |
| **Beneish M-Score** | *Do the numbers show patterns that sometimes point to a company "dressing up" its accounts?* |

Each score comes with the figures it was calculated from, so it can always be checked and explained. It is never an unexplained "black box" verdict. When there isn't enough history to calculate a score fairly, the system says so honestly instead of guessing.

These scores were tested against real historical cases, companies whose later troubles are now known, to confirm they behave sensibly.

### 5. It notices what companies start (or stop) worrying about
Every annual report has a section called **"Risk Factors"**, where a company lists everything that could go wrong for its business. EDGAR Radar compares each company's latest list with the previous year's and highlights **what's new and what disappeared.**

It doesn't just compare word for word. It uses a type of artificial intelligence that understands *meaning*, so it can tell a reworded old warning from a genuinely new concern. In testing it correctly surfaced real events, such as Google's parent company adding risks about its **$32 billion acquisition of the security firm Wiz**, and Tesla adding risks around its **Robotaxi launch**.

### 6. It can alert people
Users can create an account and keep a **watchlist** of companies they care about. When a watched company files something new, the system can send a notification.

---

## It looks after itself

A system like this is only useful if it keeps running, so a lot of the work went into making it dependable:

- **It raises the alarm if it stops.** A separate "heartbeat" checks every 15 minutes that the watcher is still working. This was tested on purpose: the watcher was switched off for almost 3 hours, and the system sent **exactly one alert**, not a flood of repeated ones, then went quiet once things recovered.
- **It follows the SEC's rules.** The SEC allows at most 10 requests per second from any one user. EDGAR Radar is built so that **it cannot break this limit**, even with several parts working at once, and an automatic test enforces it.
- **It can handle crowds.** It keeps a copy of frequently requested answers ready (a "cache") and a second copy of the database (a "replica") to share the load. Under a load test it answered **over 4,000 requests per second**.
- **It's tested automatically.** Every change is checked by more than 180 automated tests before it's allowed to go live. If any test fails, the change is blocked.
- **It costs nothing to run.** It lives on Oracle Cloud's permanently free tier: no trial that runs out, and no monthly bill.

---

## An everyday analogy

Imagine hiring someone to:

1. Stand by the mailbox of 196 companies and grab every letter they send out,
2. Copy the important numbers from each letter into a tidy notebook,
3. Cross out any numbers that are obviously wrong,
4. Once a night, check the notebook against the official archive,
5. Work out three "health check" grades for each company,
6. Once a year, lay each company's list of worries next to last year's and circle what changed,
7. Ring a bell, **once**, if they ever fall asleep on the job.

EDGAR Radar is that person, as software, working 24 hours a day.

---

## Who might use it

- **Individual investors** who want warning signs about a company without reading hundreds of pages.
- **Students and researchers** studying company finances over time.
- **Journalists** looking for companies that suddenly started warning about something new.

> **Important:** EDGAR Radar surfaces information and well-known indicators. It is **not** investment advice, and a score is a prompt to look closer, not a verdict.

---

## Where things stand today

**Working now:**
- The system is live on the internet and runs by itself, around the clock.
- It watches 196 companies, collects their financial numbers, scores them, and compares their risk warnings year to year.
- It has been tested under failure (deliberately switching parts off) and under heavy load.

**Not built yet:**
- **A simple website.** Right now the system is used by sending it requests the way other software would (an "API"). A friendly website, where anyone can type "Apple" and see charts and plain-English scores, is the planned next stage.
- **An Indian-markets version** (companies listed on India's NSE and BSE exchanges) is planned for later.

---

## A few terms, explained

| Term | Meaning |
|---|---|
| **SEC** | The US government agency that oversees stock markets and requires companies to publish reports. |
| **EDGAR** | The SEC's public online library of every company filing. |
| **Filing** | Any official document a company submits to the SEC. |
| **10-K** | A company's detailed annual report. It includes the "Risk Factors" section. |
| **API** | A way for software to ask another program for information. It's how EDGAR Radar is used today, before it has a website. |
| **Cache** | A stash of recently used answers kept ready, so repeat questions are answered instantly. |
| **Replica** | A live copy of the database that shares the work of answering questions. |
