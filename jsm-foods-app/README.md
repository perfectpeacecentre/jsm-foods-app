# JSM Foods App

Version 1: username + 4-digit PIN login, roles (admin / owner / sales), customer database.

- Plain HTML/CSS/JS (no build step), Firebase Auth + Firestore + Hosting
- `public/` is the website. `firestore.rules` controls who can read/write data.

## Roles
| Role  | Add customers | Edit own entries | Edit/delete any | Manage staff |
|-------|---------------|------------------|-----------------|--------------|
| sales | yes           | yes              | no              | no           |
| owner | yes           | yes              | yes             | yes          |
| admin | yes           | yes              | yes             | yes          |

## Known limits
- A 4-digit PIN is weak (10,000 combinations). Firebase rate-limits repeated wrong attempts, which helps, but treat this as light protection.
- A PIN cannot be changed from inside the app yet. To reset one, set a new password in Firebase console > Authentication (the password is `jsm-` followed by the 4 digits, e.g. `jsm-4821`).

## Deploy
```
firebase deploy --only firestore:rules,hosting
```
