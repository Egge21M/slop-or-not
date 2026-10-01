# Single instance on Fly.io

The private pilot runs as one application instance on Fly.io. Brief downtime during deployment or restart is acceptable, so this version does not require multiple replicas or high availability; acknowledged Questions and Responses must still survive ordinary application restarts. The instance stays running rather than automatically stopping while idle, so server-held Undo deadlines and agent waits can continue after the phone page closes.
