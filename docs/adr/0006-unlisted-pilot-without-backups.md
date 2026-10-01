# Unlisted pilot without backups

The private testing group receives an unshared deployment URL; Inbox creation has no invite-code gate or account registration. Keeping the URL unshared limits intended distribution rather than enforcing access control, so anyone who discovers the URL can create an Inbox, while existing Inbox access still requires its shared credential.

The pilot has no backups and disables automatic Fly Volume snapshots. Application state must survive ordinary deployments and restarts, but an irrecoverable volume failure may lose Inboxes; backup recovery and restoring deleted Inboxes are deferred.
