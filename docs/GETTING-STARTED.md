# Getting started

A plain-English guide for your first hour with Website Generator. No
programming knowledge needed.

---

## 1. What this app is

Website Generator builds a website for a real business. You tell it about the
business, and it researches it, designs it, writes the words, and gives you a
finished website you can edit and publish.

You can build five kinds of project:

| Kind | Good for |
| --- | --- |
| **Full business website** | Services, about, contact — the usual website |
| **Digital menu** | A QR-code menu guests read at the table |
| **Portfolio** | Showing work and photographs |
| **Landing page** | One page with one thing to do |
| **Bookings** | Getting calls and reservations |

Most people use the first two, and they are genuinely different things:

**A full business website** is a normal website. It has a header, several
sections (about, services, contact), and you write or edit the words inside the
app.

**A digital menu** is deliberately stripped back. No header, no big picture at
the top, no animation — a guest who scans a QR code sees categories and prices
straight away. Its menu items don't come from the app at all: they come from a
**Google Sheet** you keep updating. You edit the spreadsheet, press Sync, and
the menu changes.

Every website it makes works properly on phones. That never changes, whatever
you build.

---

## 2. How the app works

```
Create an account / sign in
        ↓
Create a project
        ↓
Enter the business information
        ↓
(Digital menu only) connect Google Sheets
        ↓
The app researches the business
        ↓
The website is designed and written
        ↓
You look at it and change what you want
        ↓
Publish it
```

Three helpers do the work behind the scenes. You don't have to manage any of
them.

- **Gemini** — Google's online AI. It researches the business, writes the
  words, translates them, and carries out the changes you ask for in your own
  words. It needs a key (see section 9). **Without it the app still works**: it
  writes the site from what you typed instead.
- **Local AI (Ollama)** — a small AI that runs on your own computer, with no
  internet and no account. It has one job: turning what you typed about the
  business into a good question for the design catalogue. It is optional.
- **UI/UX Pro Max** — a design catalogue: 79 styles, colour systems, font
  pairings and page layouts. It's what makes a bakery look like a bakery
  instead of a generic template. It's installed for you on first launch.
- **Google Sheets / Drive** — only for digital menus. Your menu items live in a
  spreadsheet, and your food photos in Drive.

---

## 3. What you need before you start

**Required**

- A Windows computer (Windows 10 or later).
- The Website Generator installer, which you run once.

That is all. With nothing else, you can create projects and publish real
websites today.

**Optional, and only if you want the extra features**

- **A Gemini API key** — for business research, written copy, translation and
  "ask AI to edit". You get one free from Google AI Studio
  (<https://aistudio.google.com/apikey>). Section 9 explains where to paste it.
- **A Google account** — only for a digital menu built from a Google Sheet.
- **An internet connection** — needed for the first-time setup, for anything
  Gemini does, and for Google Sheets. Once set up, the local AI works offline.

You do **not** need to install Node.js, Python, Ollama, or anything else
yourself. You do not need to open a terminal or type any commands.

---

## 4. The first launch

The first time you open the app, it sets your computer up. This happens **once**.

You'll see a setup screen with a list of steps ticking off:

1. **Checking your computer** — it looks at your Windows version, processor,
   memory, graphics card and free disk space. Nothing is sent anywhere; it
   needs the numbers to pick the right local AI.
2. **Checking installed components** — what's already on your machine, so
   nothing is installed twice.
3. **Installing UI/UX Pro Max** — the design catalogue. Takes a few seconds.
4. **Preparing local AI** — if Ollama isn't on your computer, it offers to
   install it.
5. **Choosing a local AI model** — it recommends the smallest model your
   computer runs comfortably and **shows you why**, with your memory and
   graphics listed. You then choose:
   - **Use recommended model** — downloads it, with a real progress bar showing
     megabytes, not a guess.
   - **Choose another** — pick a different size from the list.
   - **Skip for now** — no download at all. The app still works.

   **Nothing is downloaded until you press a button.**
6. **Finishing setup** — the app opens.

The whole thing usually takes a few minutes, most of it the model download.

If a step fails, it says what went wrong in plain words and offers **Try
again** — and for optional parts, **Continue without it**. If your computer is
switched off mid-download, the next launch says *Finishing your setup* and
carries on from where it stopped. It never starts the download again from zero.

---

## 5. Normal launches

After that first time:

```
Double-click the app  →  it opens  →  you start working
```

That's it. About a second. No setup screen, no downloads, no browser window, no
terminal. Updating the app later doesn't re-download your local AI model.

---

## 6. Creating your first website

### Step 1 — Make an account

On first open you'll see a sign-in screen. Choose **Create an account** and
enter your name, email and a password (at least 8 characters).

This account lives only on your computer — it's what keeps your projects
together, not an online service you're signing up to.

### Step 2 — Start a project

Click **New project** in the sidebar. There are five short steps:

1. **Your business** — the name (e.g. *Caffè Verde*), what kind of business it
   is (e.g. *coffee shop*), and a description in your own words. You can add a
   logo here too. The description matters: the more real detail you give, the
   better the result.
2. **Location** — a Google Maps link if you have one (paste the share link),
   the town or city, a phone number and an email. The phone number becomes a
   tap-to-call button.
3. **What to build** — pick **Full business website** (or one of the other
   kinds).
4. **Languages** — your main language, plus any others. Choosing two or more
   gives the finished website its own language switcher for visitors.
5. **Style** — pick a starting look, and optionally type anything specific you
   want ("dark and elegant", "lots of photos").

Then press **Generate website**.

### Step 3 — Watch it build

A progress screen names each stage as it happens: *Researching the business*,
*Consulting the design catalogue*, *Analysing the visual identity*, *Writing the
content*, *Translating*, *Generating SEO metadata*, *Checking the page at four
screen sizes*, *Building the website*.

You can leave this screen or close the window — it keeps running.

**About the research:** with a Gemini key, the app searches the web for the
business and uses only what it can actually confirm. If it can't confirm your
opening hours, it leaves the hours section out rather than inventing times a
customer might turn up on. Same for prices, reviews and awards. Without a key,
it uses what you typed and nothing more.

**About the design:** the design catalogue suggests a style, colour system,
font pairing and section order for this type of business. Nothing is a
recoloured template — two different businesses genuinely come out different.

**About your photos:** whatever you uploaded before generating is placed, not
inserted. Each picture is measured, and the strongest wide one leads the page,
cropped around wherever the detail actually is so nobody's head gets cut off on
a phone. A tall photo is put in the gallery instead of stretched across the
top. If you uploaded nothing, you get a page designed for type — never a grey
box where a photo should be.

**About Google:** the page title, description and the data search engines read
are built from what the research could actually confirm. If your location was
never confirmed, it isn't claimed. Ratings and reviews are never invented at
all.

**The visual check:** before it finishes, the app checks the page at desktop,
tablet, phone and narrow-phone widths. Anything it can safely fix itself — a
heading too big for a small screen, an empty section, text that's hard to read
— it fixes. Anything only you can decide is listed on the project screen under
**Visual check**, with the exact thing to do. It never rewrites your words to
make a check pass.

When it's done you'll see **Your website is ready**.

Sometimes it will ask you **a few questions about the design** — only when a
real choice couldn't be worked out from what you gave it. Answer them, or don't.

### Step 4 — Look at it

Click **Preview** in the sidebar. You can view it at phone, tablet and desktop
widths.

### Step 5 — Change it

- **Content** — your sections listed on the left, the live website on the
  right. Click a section to edit its words. Drag the handle, or use **Move up**
  and **Move down**, to reorder. Hide a section you don't want.
- **Ask AI to edit** — the button under the section list. Type what you want in
  ordinary words: *"make the tagline warmer"*, *"add a section about
  deliveries"*. (This one needs a Gemini key. Without it, you'll still get
  colour, style, layout and section changes.)
- **Design** — change colours, fonts and layout by hand.
- **Media** — upload photos; they're optimised for you.
- **Languages** — add or remove a language after generating. Adding one
  translates the text and provably leaves the design and prices alone.
- **Versions** — save a snapshot before a big change, and restore it later if
  you prefer the old one.

### Step 6 — Publish it

Click **Publish** in the sidebar. Choose **Built-in hosting** — no accounts, no setup — pick a
name for the address, and press **Deploy**. It's live immediately, and you can
copy the link.

(Vercel and Netlify appear too, but they need tokens configured on the server.
Built-in hosting works right now.)

Prefer to host it elsewhere? **Export** gives you a ZIP of the whole site to
upload wherever you like.

---

## 7. Creating a digital menu

A digital menu works like a normal project with one difference: **the menu
items come from a Google Sheet, not from the app**. You keep the spreadsheet;
the app reads it.

### Step 1 — Prepare your spreadsheet

Create a Google Sheet. **Row 1 must contain exactly these six headers**, spelled
this way:

```
name | price | description | chefs choice | category | imageurl
```

Every row underneath is one menu item.

| Column | What goes in it |
| --- | --- |
| `name` | The dish name. Required. |
| `price` | The price, e.g. `4.50` or `€4.50` |
| `description` | A short line about the dish |
| `chefs choice` | A checkbox. Ticked items get a Chef's Choice badge — guests never see TRUE or FALSE |
| `category` | Groups the menu (Coffee, Pastries, Salads). A dropdown keeps it consistent. Only categories with items are shown |
| `imageurl` | A Google Drive link to a photo. Any of the usual shapes work |

Don't rename the headers — the app looks for exactly these.

### Step 2 — Create the project

Make a new project as in section 6, but at **What to build** choose **Digital
menu**.

### Step 3 — Connect Google

Open the project and click **Menu data** in the sidebar, then **Connect Google
Sheets**. Your normal browser opens for Google's sign-in. Sign in and approve.

The app only ever asks for **read-only** access to your Sheets and Drive. It
cannot change or delete anything in your Google account.

### Step 4 — Pick the spreadsheet

Click **Choose spreadsheet**, pick your file, then pick the tab inside it. The
app checks the columns straight away and tells you if any are missing.

### Step 5 — Sync

Press **Sync now**. The app reads the rows, checks every one, downloads each
Drive photo once, optimises it, and builds the menu.

**Bad rows don't break the menu.** Each row is checked on its own, and a
problem is reported by row number and column — *"Row 6 · price: 'ask the chef'
is not a valid price"* — while every good row keeps working.

### Step 6 — Keep it up to date

Change a price in the spreadsheet → open **Menu data** → **Sync now**. If the
menu is already published, the live version updates too.

Some useful things to know:

- Photos are downloaded and served from your own site, so guests never wait on
  Google and the menu loads fast.
- Syncing changes the **menu content only** — never your design.
- Each sync saves the previous version first, so a bad spreadsheet edit can be
  undone.
- If Google can't be reached, the error appears in the builder and **your last
  good menu keeps serving**. Nothing is invented to fill the gap.
- The published menu contains no sign of any of this — no controls, no mention
  of spreadsheets. Guests just see the menu.
- The spreadsheet stays in one language. Translations are handled by the app,
  and prices and photos can't be altered by a translation.

---

## 8. The AI, in one page

**Gemini — the online one**

- Researches the business, writes the words, translates, and does "ask AI to
  edit".
- Runs on Google's servers, needs a key and an internet connection.
- Optional. Without it the app writes the site from what you typed and the
  editor still handles colours, style, layout, languages and sections.

**Local AI (Ollama) — the one on your computer**

- Runs on your machine. No account, no key, no internet, nothing sent anywhere.
- One job: turning your business description into a good question for the
  design catalogue. It's a small job, which is why a small model is used.
- Optional. Without it, a built-in rule set writes that question instead.

**UI/UX Pro Max — the design knowledge**

- Not an AI. A catalogue of 79 styles, colour systems, font pairings, page
  layouts and design rules.
- It's what decides a bakery gets warm colours and a serif, and an architecture
  studio doesn't.
- Installed during first launch and always used.

The short version: **Gemini writes, the local AI asks the right design
question, UI/UX Pro Max supplies the design knowledge.** They are separate and
never replace one another.

You can see which are running at any time: **Profile → Design engine**.

---

## 9. Adding your Gemini API key

1. Get a key from Google AI Studio: <https://aistudio.google.com/apikey>.
2. In the app, click **Profile** in the sidebar.
3. Find the card headed **Keys on this computer**.
4. Paste your key into **Gemini API key** and press **Save keys**.

It works immediately — no restart.

**About safety:** the key is stored encrypted in your own Windows user profile.
It never leaves your computer except to talk to Google, it's never shown again
after you save it (you'll see only the last four characters), and it's never
included in any website you publish. Treat it like a password: don't paste it
into emails or chats.

> Running the app as a web server rather than the Windows app? Then the key is
> set as an environment variable called `GEMINI_API_KEY` instead — see the
> README. The Profile card appears only in the Windows app.

---

## 10. Common problems

**"Connect a Gemini API key for free-form edits"**
No key is saved. Add one as in section 9. Everything else keeps working
meanwhile.

**The key was rejected / research came back empty**
Usually a mistyped or expired key. Check it in Google AI Studio and paste it
again in **Profile → Keys on this computer**. Generation never fails because of
this — the app falls back to writing the site from your own inputs.

**"Ollama is not running" on the Profile screen**
The local AI isn't installed or isn't started. It is optional: designs still
come from the catalogue. To add it, install Ollama from
<https://ollama.com> and reopen the app.

**Google won't connect / the spreadsheet won't open**
- Make sure you're signing in with the Google account that owns the
  spreadsheet.
- Check the sheet's headers are exactly the six in section 7.
- Reconnect from **Menu data → Connection settings**, or **Disconnect Google**
  and connect again.
- If Google is unreachable, your last good menu keeps serving — nothing is
  lost.

**The first-time setup was interrupted**
Just open the app again. It says *Finishing your setup* and carries on from
where it stopped. Nothing already installed is installed twice, and a
part-finished download resumes rather than restarting.

**A setup step failed**
Press **Try again**. For optional parts you'll also see **Continue without it**
— the app opens and works, and you can set that part up later.

**The website didn't come out as expected**
- Rewrite the description with more real detail and generate again — that
  single field drives most of the result.
- Answer the design questions if it asked any.
- Use **Design** to change colours, fonts and layout by hand.
- Use **Versions** to go back to an earlier save.

**A menu row didn't appear**
Look at **Menu data** — invalid rows are listed by row number and column with
the reason. Fix that cell in the spreadsheet and press **Sync now**.

---

## Where to go next

- [DESKTOP.md](DESKTOP.md) — how the Windows app and its first-launch setup
  work in more detail.
- [PACKAGING.md](PACKAGING.md) — for developers building the installer.
- [../README.md](../README.md) — how the whole thing is put together.
