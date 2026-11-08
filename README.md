# Teacher Resource Share

A page where Lausanne teachers share websites and resources they find with each other: the link, subjects, grade levels, a description, their favorite part, and their name.

- `index.html` is the page. The subject and grade choices are the `SUBJECTS` and `GRADES` lists near the top of the script.
- Posts are stored in a private Google Sheet. An Apps Script web app attached to it reads and adds them. Its URL goes in `API_URL` in `index.html`.
- Anyone can post. A teacher can remove their own post from the browser they posted from. To remove any post, delete its row in the sheet.
