/**
 * Every string the public site shows a human, in ONE module (D-08).
 *
 * A plain module: no server directive, no `next/*`, no `@/db`. The 11 September
 * copy request is meant to be a one-file swap, and that is only true while the
 * sentences live apart from the markup that renders them —
 * `src/core/reporting/copy.ts` is the same discipline for the same reason.
 *
 * Everything below is verbatim from the 09-UI-SPEC Copywriting Contract. The
 * voice rules it enforces (outcome first, plain Australian, sentence case, no
 * exclamation marks, no em dashes, digits for numbers, and a forbidden-word
 * list) are not style preferences: they are what makes a stranger's first
 * contact with the service read like a tradesperson wrote it.
 *
 * THIS IS THE FILE THE 11 SEPTEMBER COPY REQUEST REPLACES (D-08). Everything a
 * stranger reads is in it and nowhere else, so the swap is one file and one
 * review, and `tests/marketing-copy.test.ts` re-runs the whole voice contract
 * over whatever arrives: the forbidden-word list, the single AI disclosure, the
 * punctuation rules and the M2 figures. Add a string anywhere but here and the
 * next revision silently misses it.
 *
 * The ONE import is `@/core/brand`, which is itself import-free and pure: the
 * contact details and the legal identity are facts about the business, not
 * copy, and a second spelling of an ABN or a phone number is the failure D-16
 * and D-17 exist to prevent.
 */
import {
  ABN_DISPLAY,
  BUSINESS_LOCATION,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_E164,
  OPERATOR_LEGAL_NAME,
  TAGLINE,
} from '@/core/brand';

/** `/audit` — the request form (UI-SPEC "Audit form"). */
export const AUDIT_FORM_COPY = {
  title: 'Free Quote Leakage Audit',
  description:
    'One A4 page from your ServiceM8 data: quotes sent, value never followed up, estimated recoverable range. Back within one business day.',
  h1: 'Get the free Quote Leakage Audit',
  lede: "One A4 page from your own ServiceM8 data: quotes sent in the last 90 days, value never followed up, estimated recoverable range. Fill this in and we'll come back within one business day.",

  labels: {
    business_name: 'Business name',
    contact_name: 'Your name',
    phone: 'Mobile',
    email: 'Email',
    trade: 'Trade',
    servicem8: 'Do you use ServiceM8?',
    quotes_per_month: 'Quotes sent per month, roughly',
    /** The one optional control, and its label says so (UI-SPEC C-8). */
    csv_file: 'ServiceM8 export (optional)',
  },

  hints: {
    phone: "We'll text you when the audit is ready.",
    email: 'Where we send the one-page audit.',
    /**
     * The cap here is 4 MB, and D-10 and the UI-SPEC both wrote 5.
     *
     * A recorded deviation (09-03, option `cap-4mib`): Vercel Functions refuse a
     * request body over 4.5 MB with a 413 raised before the action runs, so a
     * 4.6-5 MB file promised acceptance here would meet a platform error page
     * nobody at Backdesk wrote. The sentence a prospect reads has to be a
     * sentence the system can keep. A ServiceM8 Job List export for a 1-10 staff
     * business is far under 1 MB, so nobody meets either number in practice.
     */
    csv_file_howto: 'How to get the export, or a read-only key instead',
    csv_file:
      'If you have a ServiceM8 Job List export handy, attach it and the audit is faster. CSV only, up to 4 MB.',
  },

  /**
   * The file input is the ONE control whose value a rejection cannot preserve —
   * browsers do not let a server re-populate it, for good reason. So after any
   * rejected submit the hint says out loud that this one has to be done again,
   * rather than letting a prospect submit a second time without the export and
   * wonder why nothing was attached.
   */
  csvReattach: 'Attach the export again.',

  /**
   * The two ways an attachment is refused (UI-SPEC Copywriting Contract), keyed
   * by the `sniffCsv` refusal kind. BOTH name a way forward that does not need
   * the file: the audit is still possible without it, and a prospect who thinks
   * the export is mandatory is a prospect who closes the tab.
   */
  csvErrors: {
    type: "That file isn't a CSV. Export the Job List from ServiceM8 as CSV, or leave this out.",
    size: "That file is over 4 MB. Leave it out and we'll get the data another way.",
  },

  /** The disabled first option on both selects. */
  choosePlaceholder: 'Choose one',

  /** The two radios in the ServiceM8 fieldset. */
  yes: 'Yes',
  no: 'No',

  consentLead:
    'By sending this you agree that Backdesk can use these details to prepare your audit and contact you about it. How we handle your information: ',
  consentLinkText: 'privacy notice',
  consentTail: '.',

  /**
   * The label on the off-screen decoy (UI-SPEC C-8). A human never reads it;
   * it exists because a labelless input is the thing some bots skip, and
   * because an input with no label at all is a lint failure waiting to happen.
   * Deliberately the blandest possible word — nothing here names the field for
   * what it is, in markup a script can read.
   */
  decoyLabel: 'Website',

  submit: 'Send the audit request',
  submitPending: 'Sending…',

  /** Field-level failures, keyed by form field name. Pinned by the schema suite. */
  errors: {
    business_name: 'Enter your business name.',
    contact_name: 'Enter your name.',
    phone: 'Enter an Australian mobile number, like 0412 345 678.',
    email: 'Enter an email address we can reply to.',
    trade: 'Choose the closest trade.',
    servicem8: "Tell us whether you're on ServiceM8.",
    quotes_per_month: 'Choose a rough number of quotes a month.',
  },

  /**
   * Form-level refusals. Both name a way forward that does not need the form to
   * work: a dead end during a first contact is a prospect who does not come
   * back. The throttle that produces the first one lands in 09-03; the sentence
   * lives here now so both plans read the same words.
   */
  rateLimited:
    "We've had a few requests from this connection in the last hour. Try again later, or email hello@backdesk.com.au with your business name and we'll set the audit up by hand.",
  serverError:
    "Something went wrong on our side and your request wasn't saved. Try again in a minute, or email hello@backdesk.com.au.",
} as const;

/** `/audit/thanks` — the confirmation (UI-SPEC "Confirmation", D-14). */
export const THANKS_COPY = {
  title: 'Request received',
  description: "We'll come back within one business day.",
  h1: "Thanks, we've got it.",
  body: "We'll look at your ServiceM8 data and come back within one business day with the number. If we need the export or a read-only key, we'll text you.",
  contactLead: 'Questions in the meantime: ',
  /**
   * From the brand module as of 09-05, replacing the three literals 09-01 left
   * here with a note. A confirmation page is where a prospect goes looking for
   * a way to reach a human, and the number they find there has to be the same
   * number the footer prints and the SMS comes from.
   */
  contactEmail: CONTACT_EMAIL,
  contactPhoneDisplay: CONTACT_PHONE_DISPLAY,
  contactPhoneE164: CONTACT_PHONE_E164,
  backLink: 'Back to backdesk.com.au',
} as const;

/**
 * `/audit/how-to` — how a prospect hands us their ServiceM8 data (LAND-05).
 *
 * The Phase 9 copy request asked for this page in so many words, and asked for
 * it VERIFIED: marketing would not publish guessed menu paths, because a step
 * that sends a stranger looking for a screen that is not there is the first
 * thing they learn about how carefully this service reads.
 *
 * So every step below is a path ServiceM8 documents in public, and nothing
 * else. The API-key path is the developer docs' own sentence ("go to Settings
 * -> API Keys"); the export path is the Help Centre's ("How do I generate
 * Reports?" — enable the Advanced Reporting Pack under Settings > ServiceM8
 * Add-ons, then Reports > Job List Export, which exports job details as CSV).
 *
 * TWO THINGS ARE DELIBERATELY NOT CLAIMED HERE. The console calls the key a
 * "read-only API key"; this page now says it too, after the founder verified it (see below):
 * docs do not describe key scopes, so whether a key can be limited is not a
 * fact this page may state to a stranger. Nor is a date filter on the export
 * claimed — the Help Centre article documents none, so the steps say save the
 * whole file and the note says which part of it the audit uses.
 *
 * FOUNDER-VERIFIED 2026-09-12 on the ServiceM8 trial account: (1) Settings > API Keys
 * exists as written and the key's access level (incl. read-only) is chosen at
 * creation and cannot be changed afterwards — so the step says so; (2) Reports >
 * Job List Export produces a CSV. Whether that export has a date filter was not
 * confirmed either way, so the page keeps the 'covers every job' line.
 */
export const HOWTO_COPY = {
  h1: 'How to give Backdesk your ServiceM8 data',
  lede: 'Two ways. Either one takes a couple of minutes, and the key gives the more accurate audit.',

  options: [
    {
      id: 'api-key',
      h2: 'Option 1: an API key',
      steps: [
        'Sign in to ServiceM8 on a computer.',
        'Open Settings.',
        'Open API Keys.',
        'Create a key, name it something like Backdesk audit, and set its access to read-only. The access level is set when the key is created and cannot be changed later.',
        'Copy the key.',
      ],
      note: 'Picked the wrong access? Delete the key in the same screen and make a new one. You can delete it whenever you like.',
    },
    {
      id: 'job-list-export',
      h2: 'Option 2: the Job List export',
      steps: [
        'Open Settings, then ServiceM8 Add-ons.',
        'Turn on the Advanced Reporting Pack, if it is not on already.',
        'Open the Reports tab.',
        'Choose Job List Export.',
        'Save the CSV file it gives you.',
      ],
      note: 'That export covers every job, not just recent ones. The audit reads the last 90 days of quotes from it.',
    },
  ],

  /*
   * THE SENTENCE, WORD FOR WORD FROM THE REQUEST (§3.2), with the address read
   * from the brand module rather than typed again. It is defined once and
   * rendered on both pages by reference: this is the sentence that tells a
   * stranger what we will and will not look at, and two copies of it is one
   * copy nobody updates.
   */
  sentence: `Send the key or the file to ${CONTACT_EMAIL} or reply to Hesam's text. Backdesk sees quotes, job statuses and the customer details on those quotes. Nothing else. If you don't go ahead, we delete it after 30 days.`,

  backLink: 'Back to the audit form',

  /** The same block on the confirmation page (request §3.3, D-14). */
  thanksH2: 'Two ways to send us the data',
  thanksLink: 'These steps on their own page',
} as const;

/**
 * `/` — the landing page, in the D-09 section order (UI-SPEC "Landing page").
 *
 * The sentences are the M2 offer sheet's, laid out for a phone: the promise,
 * how it works, what it costs, what happens if it does not work, whose name it
 * goes out under, who it is for, how to start. Section 5's fourth paragraph is
 * split around a link because the residency sentence is the one a prospect is
 * most likely to want to check, and a sentence that cannot be checked is a
 * claim (LAND-05).
 *
 * The AI is disclosed twice, and that is deliberate and different each time:
 * once as the locked phrase `Run by AI, checked by a human` in the lede (D-09
 * permits exactly one), and once in M2's own process wording inside step 4 and
 * section 5, which D-09 permits as disclosure rather than positioning (step 3
 * until the 16 Oct 2026 repositioning put missed-call text-back ahead of it).
 */
export const LANDING_COPY = {
  headerLink: 'Free audit',
  /** Header nav, beside the audit link: the one guide, named for what it is
   *  rather than 'Guides' — there is no index page to promise (request §8). */
  headerGuideLink: 'ServiceM8 guide',

  hero: {
    eyebrow: 'Perth · ServiceM8 trade businesses',
    h1: TAGLINE,
    lede: "For Perth trade businesses on ServiceM8 that can't answer every call: a missed call diverts to Backdesk and the caller gets one text from your business within seconds, then short human-approved follow-ups until the job is booked. Every quote you send is chased by text and email until it's won or dead. Run by AI, checked by a human, reported in dollars. If the quote value we recover in your first 90 days isn't more than 3× the fees you've paid, you don't pay until it is.",
    cta: 'Get the free audit',
    reassurance:
      'Free one-page Quote Leakage Audit from your own ServiceM8 data. No lock-in. No lead generation.',
  },

  steps: {
    h2: 'How it works',
    howToLink: 'How to send us your ServiceM8 data',
    items: [
      {
        number: 'Step 1',
        title: 'Free Quote Leakage Audit',
        body: 'One A4 page from your own ServiceM8 data: quotes sent in the last 90 days, value never followed up, estimated recoverable range. You see the number before you decide.',
      },
      {
        number: 'Step 2',
        title: 'Set up in 7 days',
        body: "We connect to ServiceM8, write the text-back and follow-up templates in your voice, and you approve every one. Your number diverts to a Backdesk number when you can't answer: the caller hears a short greeting, nothing is recorded, and the text goes out. Contact hours, escalation rules and the last 90 days of open quotes agreed together.",
      },
      {
        number: 'Step 3',
        title: 'Every missed call texted back',
        body: 'One text from your business within seconds of the missed call, then two human-approved follow-ups inside business hours until the job is booked. Hot replies and anything urgent go to your phone straight away. A caller who rings twice is never texted twice; the second call is flagged to your phone instead.',
      },
      {
        number: 'Step 4',
        title: 'Every open quote chased, reported in dollars',
        body: 'Five touches over three weeks, SMS and email, from your business. Every message drafted by AI, checked by a person before it sends, with opt-out on every one. Hot replies go to your phone straight away. Then one page a month: quotes sent, quotes chased, jobs won after a follow-up, missed calls texted back, revenue recovered (gross and conservative), fees paid, multiple returned.',
      },
    ],
  },

  pricing: {
    h2: 'Pricing',
    caption: 'AUD, ex GST',
    includedLabel: 'Included',
    tiers: [
      {
        /*
         * Renamed 16 Oct 2026 with the missed-call repositioning (founder):
         * the tier is named for the first thing it does; the offer sheet's
         * "Quote Chaser" is this tier. Repriced the same day (founder, quick
         * 261016-k4p): $397 a month, no setup fee, and the first 30 days
         * free. 17 Oct 2026 (founder, quick 261017-s1c): this is the ONE
         * plan. The second tier left the site with its extras; they were not
         * folded into these bullets.
         */
        name: 'Call Catcher',
        price: '$397',
        per: '/ month',
        setup: 'No setup fee.',
        included: [
          'Your own divert number. Every missed call texted back within seconds, from your business.',
          'Two human-approved follow-ups to each missed caller inside business hours, then closed.',
          'Every new quote chased on the 5-touch sequence until won or dead.',
          'Urgent and hot replies to your phone; objection and price feedback captured.',
          'One page a month: calls caught, leads, jobs booked, recovered quote revenue.',
        ],
      },
    ],
    /*
     * 16 Oct 2026 (founder, quick 261016-k4p): the founding-five offer is
     * withdrawn and its callout carries the free first month instead, in the
     * same markup. Billing starts on day 31, which the terms state.
     */
    trial: {
      h3: 'Free Trial',
      figure: '$0',
      per: 'first 30 days',
      body: "Divert your missed calls to us and run the first 30 days free. At the end you see the report: calls caught, texts sent, leads, jobs booked. Stay on if it paid for itself; walk away if it didn't, nothing owed.",
    },
    terms:
      'Month to month, no lock-in. Billed monthly by card from day 31. Cancel any time in writing, effective at the end of the month, from either side. Prices exclude GST. The client agreement is in plain English and you keep the data.',
  },

  guarantee: {
    /*
     * Resolved 16 Oct 2026 by the missed-call repositioning. The lede keeps the
     * 3× conditional as its last sentence, so the heading stays "The guarantee,
     * precisely" rather than printing that sentence twice on one page. The body
     * is already explicit that the multiple is on recovered quote value.
     */
    h2: 'The guarantee, precisely',
    body: 'If the recovered quote value we attribute in your first 90 days is not more than 3× the monthly fees you paid in that period, the service is free until it is. Attribution is agreed before we start: a job counts when it is won after one of our follow-ups, and every report shows the figure two ways, gross and conservative (net of the win rate you already had before we connected). We deliberately count low.',
  },

  customers: {
    h2: 'Your customers, your name',
    paragraphs: [
      'Follow-ups come from your business, in your voice, using templates you approved. Prices and dates are taken from ServiceM8 exactly; a message that changes them does not send.',
      'Every SMS and email identifies your business and carries an opt-out. Sends stay inside business hours, Perth time. Any customer can be stopped the same day, by you or by them.',
      'Every message is drafted by AI and checked by a person before it goes, and that is disclosed. Complaint and opt-out rates are tracked as a first-class number; above 5% of contacts we stop and call you.',
    ],
    /*
     * LAND-05's prohibition, as a sentence rather than as a policy: the site
     * may NOT claim full Australian data residency. Storage is named (Sydney),
     * and so are the providers that process content offshore. It is split
     * around the link so the notice is one tap away from the claim.
     *
     * 2026-10-15 (15-REVIEW WR-03): "Email and AI providers", not "Messaging
     * and AI providers": SMS goes through ClickSend, an Australian provider,
     * and the privacy notice says so in two places. Email (Resend) and
     * drafting (Anthropic) are the ones processed outside Australia.
     */
    residencyLead:
      'Your quote data and our logins are held in Sydney. Email and AI providers process message content outside Australia. Full privacy notice at ',
    residencyLinkText: 'backdesk.com.au/privacy',
    residencyTail: '.',
  },

  fit: {
    h2: 'A good fit',
    body: "Perth, 1–10 staff, owner-run, on ServiceM8, jobs worth $2k–50k. Best fit: trades that miss calls because they're on the tools or on call, so plumbers, electricians, locksmiths, HVAC, and anyone with emergency or after-hours work. Also a good fit: solar, patios, painting, landscaping and small builders sending 10 or more quotes a month. Not a fit: anyone wanting lead generation. We text back the calls you already get and chase the quotes you already send.",
  },

  start: {
    h2: 'How to start',
    body: 'Start with the free audit. One A4 page from your own ServiceM8 data, back within one business day. No account, nothing to install.',
    cta: 'Get the free audit',
  },

  footer: {
    guide: 'ServiceM8 guide',
    privacy: 'Privacy notice',
    audit: 'Free audit',
    /*
     * The LABEL only. The address lives on `FACEBOOK_URL` in `@/core/brand`,
     * because `tests/marketing-copy.test.ts` forbids a domain-shaped string in
     * any public sentence — the only domain allowed on the page is ours, and
     * that rule is what stops another product's address being typed into a
     * paragraph. A link's text and a link's target are different things anyway:
     * this is the word a reader taps.
     */
    facebook: 'Facebook',
  },
} as const;

/**
 * `/privacy` — a real notice, in the APP 1 and APP 5 shape (LAND-05, D-16).
 *
 * Written to be read by the person filling in the form, not by a lawyer: plain
 * sentences, the actual provider names, the actual retention periods. The
 * numbers here are the ones the system enforces — 30 days on an attached
 * export is `AUDIT_UPLOAD_RETENTION_DAYS` swept by the daily tick (09-03), and
 * 30 days on a prospect's quote lines is the `purge_after` the Phase 2 purge
 * job applies. A retention promise the code does not keep is the worst kind of
 * sentence to put on this page.
 *
 * `tests/privacy-page.test.ts` pins the two load-bearing sentences byte for
 * byte: where the data is held, and who processes it outside Australia. A new
 * processor is a NEW sentence (Twilio, Phase 12): the pinned ones never move.
 *
 * The callers section (Phase 12, D-11) first described only the retention the
 * code kept at the time — the call record kept with the client's service
 * records for the agreement's term, deleted on request (D-22) — because no
 * job enforced a period yet. Phase 15 replaced that paragraph when COMP-02
 * shipped the nightly pseudonymisation pass (`src/core/leads/pseudonymise.ts`,
 * D-06): the ninety days stated there is `PSEUDONYMISE_AFTER_DAYS`, and the
 * read-back suite `tests/pseudonymise.test.ts` is what proves the sentence.
 * Phase 15 also rewrote the callers processors paragraph to say where each
 * provider runs (D-05). `privacyCoversCallers` in
 * `src/core/onboarding/privacy-coverage.ts` is what the text-back arm action
 * checks against this section — it needs `Twilio` and `ClickSend` INSIDE it.
 */
export const PRIVACY_COPY = {
  h1: 'Privacy notice',

  /*
   * Built from the brand constants, with the ABN sentence dropped whole when
   * there is no ABN (D-16: never a placeholder). Identifying who is behind the
   * service is most of what APP 1 asks for.
   */
  dateLine: `Last updated 15 October 2026. Backdesk is operated by ${OPERATOR_LEGAL_NAME}, ${BUSINESS_LOCATION}.${
    ABN_DISPLAY ? ` ABN ${ABN_DISPLAY}.` : ''
  }`,

  sections: [
    {
      id: 'collect',
      h2: 'What we collect',
      paragraphs: [
        'When you ask for a free Quote Leakage Audit we collect what you type into the form: your business name, your name, your mobile, your email, your trade, whether you use ServiceM8, and roughly how many quotes you send a month.',
        'If you attach a ServiceM8 Job List export, we collect what that file contains. An export usually holds your customers names, phone numbers, email addresses, job descriptions and quote values.',
        'We also record a one-way hash of the network address the request came from and the browser identification string it sent. We keep these to stop the form being abused, and neither is used to build a profile of you.',
        /*
         * VERBATIM FROM THE BUILD REQUEST (19 Sep 2026), and the wording is the
         * approval: marketing wrote this sentence and Code prints it, exactly.
         *
         * It says no more than what happens. What is recorded is the LINK — the
         * three utm tags and the referring site's host — and the page does not
         * mention cookies, because there is no cookie: the values sit in the
         * visitor's own session storage until the form is submitted (LAND-05).
         * Adding the word here to sound thorough would make the notice describe
         * a mechanism the product does not use, which is the one thing a
         * privacy page may never do.
         */
        'When you request an audit we record which link brought you to the site (for example our Google listing or an email), so we know which of our channels is working.',
        'For clients, we read the job, quote and contact records the service needs from your ServiceM8 account, and we keep the follow-up messages we send and the replies that come back.',
      ],
    },
    /*
     * Pulled forward from Phase 15 by D-11: no client is armed for text-back
     * before this section is live (research rule 5). Phase 15 (2026-10, D-05,
     * D-06) replaced the fourth paragraph (who processes it, and where) and the
     * last (the ninety-day pseudonymisation, COMP-02); the other four are as
     * Phase 12 shipped them.
     */
    {
      id: 'callers',
      h2: 'If you called a business that uses Backdesk',
      paragraphs: [
        'Some businesses divert the calls they cannot answer to a Backdesk phone number. If you rang one of them and heard a short greeting, this section is about you.',
        'We collect the number you called from, the number you rang, and the time and length of the call. The call is not recorded and nothing you say is kept. If your number was withheld, we do not receive it.',
        'We use your number to send you one text message on behalf of the business you called, so they can get back to you. If you reply, we keep your messages and the replies sent to you, and we pass them to that business.',
        'The call is answered through Twilio, which runs in the United States and connects through its Sydney edge; the text is sent through ClickSend, an Australian provider. Twilio processes the call details outside Australia. If the business writes back to you, the wording may be drafted with Anthropic in the United States and a person approves it before it is sent. The record itself is stored with Supabase in Sydney and handled by our software running on Vercel in Sydney.',
        'Reply STOP to any text and that business will not message your number again through us. We keep a stopped number on a do-not-message list so that the request keeps working.',
        "Ninety days after a lead closes without becoming a job, we replace your number in that record (on the call, on the lead and on your messages) with a code we cannot turn back into a number; the words you sent stay with the business's records. If you became a customer, we keep your number until the job is finished and for 90 days after that, and no later than 12 months after you booked. A STOP request is kept for as long as it is needed so that it keeps working. You can ask us to remove your number sooner, using the contact details below.",
      ],
    },
    {
      id: 'why',
      h2: 'Why we collect it',
      paragraphs: [
        'To prepare your audit and to contact you about it. To run the follow-up service for clients, and to report what it recovered. To keep the records the law asks a sender to keep, including consent and opt-out records under the Spam Act.',
        'We do not sell your information, and we do not use it to contact anyone about anything other than the service you asked us about.',
      ],
    },
    {
      id: 'where',
      h2: 'Where it is held',
      paragraphs: [
        'Your details and any file you attach are stored with Supabase in Sydney, Australia.',
        'The site and the service run on Vercel, which serves this project from its Sydney region.',
      ],
    },
    {
      id: 'processors',
      h2: 'Who else processes it',
      paragraphs: [
        'Email is sent through Resend and message drafting uses Anthropic; these providers process content outside Australia. SMS is sent through ClickSend, an Australian provider.',
        'If you called a business that uses Backdesk, the call is answered through Twilio. Twilio processes the call details outside Australia.',
        'That is why this page does not claim full Australian data residency. Storage is in Sydney; the sending of an email, the drafting of a message and the answering of a call are not.',
      ],
    },
    {
      id: 'retention',
      h2: 'How long we keep it',
      paragraphs: [
        'An export you attach is deleted 30 days after you upload it, or as soon as it has been used to prepare your audit, whichever comes first.',
        'The quote lines we read from an export to build an audit are deleted after 30 days unless you become a client.',
        'The details you gave on the form are kept until the audit is done and for 12 months after we last hear from you, then deleted.',
        'For clients, we keep service data for the term of the agreement, and financial records for 7 years as the tax law requires.',
      ],
    },
    {
      id: 'access',
      h2: 'Your access and correction',
      paragraphs: [
        'Email us and we will tell you what we hold about you, correct it, or delete it. We answer within 30 days, and usually the same week.',
        'If you are not happy with how we handled a request, you can complain to the Office of the Australian Information Commissioner at oaic.gov.au.',
      ],
    },
    {
      id: 'contact',
      h2: 'Contact',
      paragraphs: [
        'Write to us about anything on this page, including a request to see, correct or delete what we hold. A person reads it.',
      ],
      email: CONTACT_EMAIL,
      phoneDisplay: CONTACT_PHONE_DISPLAY,
      phoneE164: CONTACT_PHONE_E164,
    },
  ],
} as const;

/* ────────────────────────────────────────────────────────────────────────── *
 * `/guides/servicem8-quote-follow-up` — the first guide page (M7, 15 Sep 2026)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * THE PUBLISH GATE. False until the founder has read the Quote Follow Up
 * template editor with his own eyes.
 *
 * The page describes another company's product in detail and names it in the
 * title, so the same rule that produced `/audit/how-to` applies twice over:
 * marketing does not publish guessed ServiceM8 steps, and this page may not
 * publish invented merge-field syntax (LAND-05). The menu path below IS
 * verified against ServiceM8's own help centre; `MERGE_FIELDS` is NOT, and
 * that one unverified fact is what holds the whole page dark.
 *
 * Publishing is three edits in this file and nothing else: flip the flag, set
 * the date, and correct `MERGE_FIELDS` to whatever the editor actually offers.
 * The route un-404s, the sitemap gains the path, and the footer disclaimer
 * gains its date, all from here.
 *
 * Annotated `boolean` rather than inferred `false` on purpose: the literal type
 * would narrow `!GUIDE_PUBLISHED` to a constant and make the published branch
 * of the page unreachable to the type-checker, which is the opposite of what a
 * flag is for.
 */
export const GUIDE_PUBLISHED: boolean = true;

/**
 * The publish date, ISO, rendered into the disclaimer as "15 September 2026".
 *
 * Set it WITH the flag. `guideIsPublished()` refuses to publish without it,
 * because the disclaimer the build request made non-optional ("insert the real
 * publish date") is the one sentence that tells a reader how stale these steps
 * might be, and a disclaimer with a blank in it is worse than no disclaimer.
 */
export const GUIDE_PUBLISHED_ON: string | null = '2026-09-15';

/**
 * THE THREE MERGE FIELDS, IN ONE MAP, UNVERIFIED (FOUNDER-VERIFY).
 *
 * ServiceM8's help centre says these fields exist — "Customer's Job Contact
 * First Name", "type the brackets and the field name" — but it never prints the
 * syntax anywhere public. The three values below come from a THIRD-PARTY
 * cheatsheet (hazelwhicher.co.uk, "ServiceM8 template fields", read 15 Sep
 * 2026), which lists these three alongside the company name, the vendor name
 * and the current user's first name in the same brace style. WHETHER THE QUOTE
 * FOLLOW UP EDITOR OFFERS THE SAME LIST IS UNKNOWN.
 *
 * The three names are spelled ONCE in this file, here, on purpose: `grep` is
 * the founder's tool as much as the test is, and a second spelling in a comment
 * is a second thing to correct.
 *
 * So they live here, in one map, and the five templates are rendered from it:
 * the founder opens Settings > Automation > Quote Follow Up > Edit, reads the
 * field list in the template editor, and either confirms these three or
 * corrects them in ONE edit that fixes every message on the page. That is the
 * whole reason this is a map and not five strings typed into five templates.
 *
 * `[your business]` and `[your name]` are deliberately NOT here. They are not
 * merge fields, they are the reader's own words to fill in.
 */
export const MERGE_FIELDS = {
  // READ FROM THE QUOTE FOLLOW UP EDITOR ITSELF on 2026-09-15 (Settings >
  // Automation > Quote Follow Up > Edit > Message 1 > Insert Field): 53 fields.
  // `{recipient_first}` is the one ServiceM8's own default template uses for
  // the person the message goes to; `{job.contact_first}` also exists.
  name: '{recipient_first}',
  job: '{job.description}',
  date: '{job.quote_date}',
} as const;

/**
 * `/guides/servicem8-quote-follow-up` — the M7 copy, approved 15 Sep 2026.
 *
 * The first page of Backdesk's own content, and the only one that can be
 * written before there is client data. It exists because strangers are already
 * searching for this and landing on somebody else's page; it earns the click at
 * the bottom by being genuinely useful first, which is why there is exactly ONE
 * button on it and it is the last thing on the page.
 *
 * TWO DEPARTURES FROM THE APPROVED COPY, BOTH RECORDED FOR MARKETING in
 * `docs/gtm/requests/response-phase-10-guide-page.md`:
 *
 *  1. Step 1 of "Turning it on" reads "On a computer, open ServiceM8." The M7
 *     draft said "open the ServiceM8 Online Dashboard", and "dashboard" is a
 *     pinned forbidden word on this site (D-09). The step loses nothing: the
 *     point of it is that this is not done from the phone app.
 *  2. The two bracketed [VERIFY] editorial notes are dropped — they were notes
 *     to this thread, not sentences for a reader. What they asked for is done:
 *     the menu path is verified against the help centre, and the merge fields
 *     are quarantined in `MERGE_FIELDS` above and gate the publish flag.
 *
 * THE WORD "AUTOMATION" IS THE ONE EXEMPTION TO THE D-09 FORBIDDEN LIST, and
 * only inside this object. That list governs how Backdesk describes ITSELF; the
 * ServiceM8 add-on a reader has to find in their own menu is literally named
 * "Automation", and a guide that will not say the name of the menu item is a
 * guide that sends someone looking for a screen that is not there.
 * `tests/marketing-copy.test.ts` carries the exemption and its reason, scoped to
 * `GUIDE_COPY` and to that one word. "Dashboard" stays forbidden everywhere,
 * which is what departure 1 above is about.
 */
export const GUIDE_COPY = {
  h1: 'How to set up quote follow-ups in ServiceM8',

  intro: [
    'ServiceM8 will chase your quotes for you. It is free, it is on every plan, and most Perth trade businesses we look at have never switched it on.',
    'This page is how to set it up properly: the menu path, a schedule that works, what to write in each message, and the settings that quietly stop it working. At the end there is an honest bit about where it stops helping, because that part matters more than the setup.',
    'We run a quote-chasing service, so you would expect us to tell you the built-in tool is no good. It is good. Use it.',
  ],

  what: {
    h2: 'What it actually does',
    lede: 'Once it is on, every quote you send gets followed up automatically, by SMS or email or both, on a schedule you set.',
    bullets: [
      'Up to five follow-ups per quote.',
      'You pick the timing for each one: hours or days after the quote goes out.',
      'You write the message template for each one, once.',
      'Each SMS uses a text credit on your plan. Emails do not.',
      'It can also mark a quote Unsuccessful automatically after a period you choose. More on that below, because the default here causes trouble.',
    ],
  },

  /*
   * VERIFIED 15 Sep 2026 against ServiceM8's help centre, articles 212550866
   * ("Quote Follow Up Automation") and 214222743 ("Automation - overview"):
   * Settings > ServiceM8 Add-ons, enable Automation; Settings > Automation;
   * Edit next to Quote Follow Up; up to five follow-ups, channel and timing per
   * follow-up, one template each.
   */
  turningOn: {
    h2: 'Turning it on',
    steps: [
      'On a computer, open ServiceM8.',
      'Go to Settings > ServiceM8 Add-ons and enable Automation.',
      'Go to Settings > Automation.',
      'Find Quote Follow Up and click Edit.',
      'Choose how many follow-ups you want, up to five, and set the channel and timing for each.',
      'Write the message for each follow-up. Save.',
    ],
    closing:
      'That is the whole setup. It takes about fifteen minutes if you have your wording ready, which is the next section.',
  },

  schedule: {
    h2: 'A schedule that works',
    lede: 'There is no single right answer here and anyone who gives you a percentage is making it up. What follows is how we would set it, and why.',
    columns: ['#', 'When', 'Channel', 'Job of the message'],
    rows: [
      ['1', '2 hours after sending', 'SMS', 'Confirm it arrived and landed in the right inbox'],
      ['2', 'Day 3', 'Email', 'Offer to walk them through it'],
      ['3', 'Day 7', 'SMS', 'Ask one question that is easy to answer'],
      ['4', 'Day 14', 'Email', 'Open the door on scope or timing'],
      ['5', 'Day 21', 'SMS', 'Close the loop, politely'],
    ],
    paragraphs: [
      'The reasoning, briefly. The first one is not a chase, it is a delivery check, and it catches the quotes that went to spam or to the wrong half of a couple. Days 3 and 7 are when they are still deciding and still talking to other trades. Day 14 is when the job has usually stalled on money or timing, so that is the one where you give them somewhere to go other than silence. Day 21 ends it. Past three weeks you are annoying people, and the quote is either dead or it will come back on its own months later.',
      'Alternate SMS and email. A text gets read, an email can carry the detail, and mixing them stops the whole thing feeling like one automated drip.',
    ],
  },

  write: {
    h2: 'What to write',
    lede: "Short. Plain. From you, not from a marketing department. Put your own business name in, and use whatever merge fields ServiceM8 offers you for the customer's name and the quote.",

    /*
     * The five messages, with `[name]`, `[job]` and `[date]` rendered from the
     * ONE `MERGE_FIELDS` map above and `[your business]` / `[your name]` left
     * as literals, because those two are the reader's own words. `lines` are
     * paragraphs: the page joins them with a blank line inside a `<pre>` so the
     * whole message selects and copies as one block.
     */
    templates: [
      {
        n: 1,
        when: 'Two hours',
        channel: 'SMS',
        lines: [
          `Hi ${MERGE_FIELDS.name}, [your business] here. Just sent through the quote for ${MERGE_FIELDS.job} to your email. Give us a yell if it hasn't turned up or if anything on it doesn't make sense.`,
        ],
        note: '',
      },
      {
        n: 2,
        when: 'Day 3',
        channel: 'email',
        lines: [
          `Hi ${MERGE_FIELDS.name},`,
          `Just checking you got the quote for ${MERGE_FIELDS.job} on ${MERGE_FIELDS.date}.`,
          'Happy to walk you through any of it, or to break the price down line by line if that helps. Some people want to stage the work rather than do the lot at once, and that is usually an option too.',
          'Either way, let me know how you want to go.',
          '[your name], [your business]',
        ],
        note: '',
      },
      {
        n: 3,
        when: 'Day 7',
        channel: 'SMS',
        lines: [
          `Hi ${MERGE_FIELDS.name}, [your business]. Any thoughts on the quote? Even a "not yet" is useful, it just tells me whether to hold the spot in the calendar.`,
        ],
        note: 'That last line does the work. You are not asking them to buy, you are asking them a question that costs them nothing to answer, and a reply of any kind restarts the conversation.',
      },
      {
        n: 4,
        when: 'Day 14',
        channel: 'email',
        lines: [
          `Hi ${MERGE_FIELDS.name},`,
          `Following up on the quote for ${MERGE_FIELDS.job}.`,
          "If it is the price or the timing that is holding it up, say so and I will tell you honestly whether there is anything I can do. Sometimes there is, sometimes there isn't, but it is a quick conversation either way.",
          'If you have gone with someone else, no hard feelings at all, just let me know so I stop bothering you.',
          '[your name], [your business]',
        ],
        note: '',
      },
      {
        n: 5,
        when: 'Day 21',
        channel: 'SMS',
        lines: [
          `Hi ${MERGE_FIELDS.name}, last one from me on that quote. If the timing is off, tell me when to come back and I will. Otherwise all the best with it.`,
        ],
        note: '',
      },
    ],

    closing:
      'A note on what not to write. Do not invent a deadline that is not real, do not offer a discount that expires when it does not, and do not say "just bumping this to the top of your inbox". Tradies get sold to all day and they can smell it. The reason the messages above work is that they are what you would actually text someone.',
  },

  settings: {
    h2: 'The settings that quietly stop it working',
    lede: 'This is the part nobody reads, and it is why plenty of businesses have the automation switched on and still have a pile of unchased quotes.',
    cancelLead: 'Follow-ups cancel automatically when:',
    /*
     * The five cancel conditions, checked against help-centre article 212550866
     * on 15 Sep 2026. They are the whole reason this section exists: a business
     * with the add-on switched on and a fortnight-old unanswered reply has a
     * dead sequence and no way of knowing.
     */
    cancels: [
      'The customer replies, and you have not yet responded to or dismissed that reply. The sequence stays paused until you do.',
      'The customer accepts the quote online.',
      'The job status changes to Work Order, Completed or Unsuccessful.',
      "Someone on your team cancels it manually from the job's Diary.",
      'The quote is re-sent to a contact that is not saved on the job.',
    ],
    afterCancels:
      'The first one catches people out constantly. A customer writes back "how much to do the shed as well", it sits in the inbox for a fortnight, and because nobody responded or dismissed it, the remaining follow-ups never fire. The quote goes quiet and the system looks like it is working.',
    unsuccessfulLead: 'And the Unsuccessful setting.',
    unsuccessful:
      'ServiceM8 can auto-mark quotes Unsuccessful after a period you choose, and it is switched on by default at 60 days. Set that short and you will bury live work. A patio quote from six weeks ago is not dead, it is waiting on a tax return or a partner. We would leave it off, or set it well out at 90 days, and make the decision yourself. A quote you never marked dead is a quote you can still win.',
  },

  limits: {
    h2: 'Where it stops helping',
    lede: 'Everything above is worth doing and it will win you jobs. Here is what it does not do, so you know what you are still carrying.',
    items: [
      {
        lead: 'It only applies from the day you switch it on.',
        body: 'Every quote sitting in your job list right now, the ones from two and six and twelve weeks ago, is not in the sequence and never will be. For most businesses that backlog is worth more than the next month of new quotes.',
      },
      {
        lead: 'It sends the template, whatever the situation.',
        body: 'The same words go to the retired couple and to the builder who has quoted you three times this year. Nobody reads the message before it goes.',
      },
      {
        lead: 'It does not handle the reply.',
        body: 'It pauses, and waits for you. The reply is the whole point of sending the follow-up, and it lands in the same inbox as everything else at 4pm on a Thursday.',
      },
      {
        lead: 'It cannot tell you what it was worth.',
        body: 'At the end of the month there is no figure. You cannot see which jobs you won because of a follow-up, so you cannot tell whether any of this is working.',
      },
    ],
    closing:
      'None of that is a criticism of ServiceM8. It is a scheduler, and it is a good one. Those four things are just work, and the work still belongs to someone.',
  },

  pitch: {
    h2: 'If you would rather not do it yourself',
    paragraphs: [
      'That is what we do. Backdesk chases every open quote you send, by text and email, in your own voice, until it is won or dead, with a person checking every message before it goes. At the end of the month you get one page: what was chased, what was won, and what came back in dollars against what you paid us. Perth trade businesses on ServiceM8, one to ten staff.',
      'Before any of that there is a free Quote Leakage Audit: one A4 page from your own ServiceM8 data showing quotes sent in the last 90 days, how much of it never got a follow-up, and what is likely recoverable. Ten minutes of your time, no cost, no obligation.',
      'If you have set the automation up properly using this page, the audit should come back close to empty, and we will tell you so and leave you alone. That is a perfectly good outcome and it costs you nothing to find out.',
    ],
  },

  /** The ONE button on the page, and it is the last thing on it (request §2). */
  cta: {
    label: 'Get the free audit',
    href: '/audit',
  },

  /*
   * REQUIRED, NOT OPTIONAL (request §6). The page names another company in its
   * title and walks a reader through that company's menus, so it says who we
   * are not affiliated with and how old the steps are. `{date}` is filled by
   * `guideDisclaimer()` from `GUIDE_PUBLISHED_ON`, which is why publishing
   * without a date is refused rather than rendered with a gap.
   */
  disclaimer:
    'Backdesk is independent and is not affiliated with ServiceM8. Setup steps were accurate as at {date}; ServiceM8 changes its interface from time to time, so check against the app.',
} as const;

/**
 * Whether the guide may be shown at all: the flag AND a date for the disclaimer.
 *
 * ONE predicate, called by the route and by the sitemap, so "published" cannot
 * mean two different things in two files — a page that 404s while sitting in
 * the sitemap is a page we asked a crawler to fetch and then refused.
 */
export function guideIsPublished(): boolean {
  return GUIDE_PUBLISHED && GUIDE_PUBLISHED_ON !== null;
}

/**
 * The footer disclaimer with the publish date rendered in Perth time, en-AU
 * ("15 September 2026").
 *
 * Here rather than in the page because it is a sentence with a hole in it, and
 * because a pure function is a thing a test can read the output of. `Intl` is
 * built in: this module stays import-free apart from the brand constants.
 */
export function guideDisclaimer(publishedOn: string): string {
  const date = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  }).format(new Date(publishedOn));

  return GUIDE_COPY.disclaimer.replace('{date}', date);
}

/**
 * The six `<title>` / `<meta name="description">` pairs (D-18, UI-SPEC
 * Metadata). `/` is absolute so it bypasses the root layout's ` · Backdesk`
 * template — the name is already the first word of it, and `Backdesk ·
 * Missed-call text-back … · Backdesk` is what a template does to a title that
 * has thought about itself.
 *
 * The audit and thanks pairs are references, not copies: those two pages had
 * their titles before this object existed, and the search result and the page
 * heading are supposed to agree.
 */
export const METADATA_COPY = {
  home: {
    title: 'Backdesk · Missed-call text-back for Perth trade businesses',
    description:
      "Every missed call texted back in seconds and followed up until it's booked. Every quote chased until it's won or dead, reported in dollars. Free Quote Leakage Audit from your own ServiceM8 data.",
  },
  audit: {
    title: AUDIT_FORM_COPY.title,
    description: AUDIT_FORM_COPY.description,
  },
  thanks: {
    title: THANKS_COPY.title,
    description: THANKS_COPY.description,
  },
  howTo: {
    title: 'How to send your ServiceM8 data',
    description:
      'Two ways to give Backdesk the data for your free Quote Leakage Audit: an API key from your ServiceM8 settings, or the Job List export.',
  },
  privacy: {
    title: 'Privacy notice',
    description:
      'What Backdesk collects, why, where it is held and how to contact us about it.',
  },
  /*
   * NO ` · Backdesk` HERE. The M7 head asked for the title "How to set up
   * quote follow-ups in ServiceM8 · Backdesk", and the root layout's title
   * template appends exactly that suffix to every non-absolute title. Spelling
   * it here too would print the name twice, which is the mistake the home
   * page's `title.absolute` exists to avoid from the other direction.
   */
  guide: {
    title: 'How to set up quote follow-ups in ServiceM8',
    description:
      'ServiceM8 can chase your quotes for you, free, on every plan. Here is how to turn it on, what to write in each message, and where it stops helping.',
  },
} as const;
