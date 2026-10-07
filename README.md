# Before You Get Cancelled

Find your worst old posts before someone else does.

Upload your own X (Twitter) data archive and the site flags every post, reply, repost and like that could come back to bite you, plus any personal info you've leaked (phone numbers, addresses, workplace, school, birthday, location tags). Results are sorted worst first, with a direct link to delete each one on X.

## Privacy

Everything runs in the browser. The archive is unzipped and scanned locally with JavaScript; nothing is uploaded, there is no backend, and no analytics. Review progress ("Mark as removed") is stored in the browser's localStorage only.

The tool only works on an archive you download from your own account, so it can't be used to dig through someone else's history.

## How it works

- `lexicon.js`: risk categories (slurs, bigotry, threats, harassment, sexual, body shaming, drugs, profanity, work/school, hot-button topics) and personal-info patterns, each a list of regexes with a weight.
- `app.js`: reads `data/tweets*.js`, `data/like*.js`, `data/account.js` and `data/profile.js` from the archive zip (via JSZip), scores each item, and renders the review UI.
- Static site: no build step. Deployed on Vercel.

## Roadmap

- Sign in with X to delete in bulk
- Optional AI pass for context (sarcasm, dog whistles, quotes vs. your own words)
- Instagram, Reddit, TikTok and Facebook archives
