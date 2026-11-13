# Connecting the study to your own Google Sheet

1. Go to https://sheets.new to create a blank Google Sheet. Name it, e.g. "Music Study Results".
2. In the sheet: **Extensions → Apps Script**. Delete the sample code, paste in all of `backend/Code.gs`, and click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then **Authorize access** and allow it. If you see "Google hasn't verified this app", click **Advanced → Go to (project name)**. It's your own script.
4. Copy the **Web app URL** (ends in `/exec`) and paste it as `backendUrl` in `config.js`.
5. Open the URL in a browser: it should say `Music study backend is running.`

Results appear in two tabs, created automatically on the first participant:

- **Sessions**: one row per participant: `participant_id` (1, 2, 3…), start/finish times, device, and the answers to the opening questions.
- **Responses**: one row per song pair: `preferred_clip` (A / B / Neutral), `preference_label` (e.g. "Really like Clip B"), `slider_raw` (−3…+3, negative = Clip A), `score_original_vs_ai` (positive = preferred the original), play counts, and timings.

**Changing the script later:** edit, save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. Creating a *New deployment* instead gives a new URL that you'd have to paste into `config.js` again.

To share the results, use the sheet's **Share** button like any Google Sheet.
