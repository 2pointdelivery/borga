# Deploying Borga on Oracle Cloud Always Free

One VM runs everything: the app, MySQL 8, and Caddy (automatic HTTPS). Webhooks from Twilio and Meta need that public HTTPS address.
Status: written and reviewed, **not yet run on a real Oracle VM** (see "First deploy" for the checks that prove it).

## 1. Create the VM
- Oracle Cloud → Compute → Create instance → **Ampere A1 (VM.Standard.A1.Flex)**, 2 OCPU / 12 GB is plenty, Ubuntu 24.04. (If A1 capacity is unavailable in your region, try another availability domain later; the AMD micro shape is too small for Next + MySQL.)
- Networking: add ingress rules for **TCP 80 and 443** to the subnet's security list. Keep 22 restricted to your IP.
- Ubuntu images also ship an iptables policy: `sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`.
- Reserve a **public IP** and point a DNS **A record** (your domain, or a free DuckDNS name) at it.

## 2. Install
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker $USER && newgrp docker
sudo git clone <your-repo-url> /opt/borga && sudo chown -R $USER /opt/borga
cd /opt/borga/deploy
cp .env.example .env && chmod 600 .env     # then edit: DOMAIN, passwords, secrets (openssl rand -hex 32), SMTP
docker compose up -d --build
```
Use hex passwords (`openssl rand -hex 24`) so the `DATABASE_URL` needs no URL-escaping.

## 3. Schedule cron + backups (systemd)
```bash
sudo cp systemd/borga-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now borga-cron.timer borga-backup.timer
systemctl list-timers 'borga-*'
```
The cron timer calls `POST /api/borga/cron` every 5 minutes: heartbeat, IMAP mailbox poll, SLA sweep, integration syncs. It also keeps the VM busy, which helps against Oracle's idle-reclamation of Always Free instances.

## 4. First deploy checks
1. `curl -fsS https://$DOMAIN/api/health` → `"db":"connected"`.
2. Sign up at `https://$DOMAIN/signup`, create the first company.
3. `sudo systemctl start borga-cron.service && journalctl -u borga-cron -n 5` → HTTP 200 JSON.
4. `./backup.sh` → `ok backups/borga-….sql.gz`; test a restore into a scratch DB once.
5. Integrations → Connections: add Twilio/Meta, press **Test connection**, copy the shown webhook URLs into Twilio/Meta.

## Operations
- Update: `./update.sh` (backs up first, pulls, rebuilds).
- Logs: `docker compose logs -f app`.
- Backups are local to the VM. Copy them off-box (e.g. Oracle Object Storage free tier, `rclone`) before trusting them.
- `docker compose down` keeps data; `down -v` **deletes the database volume**.
- Outbound port 25 is blocked on Oracle; use an SMTP provider on 587/465.

## Startup checks

The app exits at startup (see `docker compose logs app`) if `SESSION_SECRET`, `BORGA_SECRET_KEY` or `DATABASE_URL` is missing, too short or a placeholder. Generate each secret with `openssl rand -hex 32`. Missing `CRON_SECRET`, `SMTP_HOST` or `APP_URL` only logs a warning, but without `CRON_SECRET` the timers cannot trigger the heartbeat, SLA, mail and sync jobs.
