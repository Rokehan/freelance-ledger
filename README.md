# Freelance Ledger

Invoices, receipts and tax set-aside for freelance side work in Japan. Runs in the browser on phone and computer, saves on the device, and syncs to your own Google Drive. ¥0 to run.

**Privacy:** this repo only holds the app code. Your details, clients, invoices and receipts are never stored here. They live on your devices and in your Google Drive. Never upload your starter `.json` file to this repo.

---

## 1. Put it online (GitHub Pages, about 5 min, no terminal)

1. Go to **github.com/new**. Name it `freelance-ledger`, set it to **Public**, tick **Add a README**, then click **Create repository**.
2. In the new repo, click **Add file → Upload files**.
3. Unzip the download on your computer. Open the `freelance-ledger` folder, select **everything inside it** (`index.html`, `sw.js`, `manifest.webmanifest`, `README.md`, and the `css`, `js` and `icons` folders), and drag it all onto the GitHub page. Use Chrome, since it handles dragging folders best.
4. Click **Commit changes**.
5. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**, then click **Save**.
6. Wait about a minute. The app is now at **https://rokehan.github.io/freelance-ledger/**

## 2. Load your details (computer)

1. Open the app link. A welcome box appears: click **Choose starter file** and pick `jasper-starter-2026.json`.
2. Check **More → My details**, and fix the CUSTARD work dates in **Jobs** if you know them.

## 3. Connect Google Drive (one-time, about 10 min)

This lets your phone and computer share the same data.

1. Go to **console.cloud.google.com** and sign in with the Google account whose Drive you want to use.
2. At the top, open the project picker, click **New project**, name it `Freelance Ledger`, and click **Create**. Make sure it's selected.
3. Search for **Google Drive API** in the top bar, open it, and click **Enable**.
4. Open **Google Auth Platform** (search "OAuth consent screen") and click **Get started**:
   - App name: `Freelance Ledger`. Support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree, then click **Create**.
5. Go to **Audience → Test users → Add users**, add your own Gmail, and click **Save**.
6. Go to **Clients → Create client**:
   - Application type: **Web application**. Name: `Ledger web`.
   - Under **Authorised JavaScript origins**, add `https://rokehan.github.io`
   - Click **Create**, then copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
7. In the app, go to **More → Google Drive**, paste the Client ID, click **Save Client ID**, then **Connect & sync**.
8. Google will say *"Google hasn't verified this app"*. That's normal, because it's your own app. Click **Continue**, then allow access.

A **Freelance Ledger** folder appears in your Drive with `Invoices/2026` and `Receipts/2026`. Your main data is kept in a hidden app folder.

## 4. Phone

1. Open **https://rokehan.github.io/freelance-ledger/**
   - iPhone: open it in **Safari**, tap **Share → Add to Home Screen**.
   - Android: open it in **Chrome**, tap **⋮ → Install app**.
2. Open it from the home screen and skip the welcome box. Go to **More → Google Drive**, paste the same Client ID, then tap **Connect & sync**. All your data arrives.

Google asks you to sign in again about once an hour. When the top-right button says **Sync**, tap it.

## Everyday use

- **After a job:** Jobs → **+ Log work** (use the date you *worked*).
- **Taxi or train:** Receipts → **+ Add receipt** → snap it → link it to the job.
- **Invoice time:** Jobs → tick the jobs → **Create invoice** (receipts linked to those jobs are added automatically) → **✉️ Email invoice** → **Share to Outlook**. The client's address is copied for you, so paste it into *To*.
- **Money arrives:** open the invoice → **Record payment**.
- **Money tab:** income this year, the ¥200k tax-return line, how much to put aside, and who owes you.

## Updating the app later

Upload the new files over the old ones (Add file → Upload files → Commit). The app picks up the update the next time it opens with internet.

---

⚠️ Tax figures are estimates, not tax advice. Get your first tax return checked by the tax office (税務署) or a 税理士.
