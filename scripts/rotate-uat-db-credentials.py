#!/usr/bin/env python3
"""Rotate the two UAT database role passwords after they leaked into a
subagent transcript on 2026-09-06.

The point of this script is that the secret values never cross a command line,
never appear in a URL, never reach a log and never land in shell history. They
are generated in memory, written only to the env file that is their designed
home (0600), and handed to psql on **stdin**. Nothing is printed but role names
and outcomes.
"""
import os, re, secrets, shutil, subprocess, sys, urllib.parse

ENV = "/root/projects/SplashTrack/.env.uat"
PG = "splashtrack-postgres-1"
APP = "splashtrack_app"
RET = "splashtrack_retention"
ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

def gen():
    return "".join(secrets.choice(ALPHABET) for _ in range(40))

def read(path):
    with open(path) as fh:
        return fh.read()

def repoint(url, pw):
    """Replace only the password in a postgres URL, leaving everything else."""
    p = urllib.parse.urlsplit(url)
    if not p.username:
        raise SystemExit(f"no username in a {p.scheme} url; refusing to guess")
    host = p.hostname + (f":{p.port}" if p.port else "")
    netloc = f"{urllib.parse.quote(p.username, safe='')}:{urllib.parse.quote(pw, safe='')}@{host}"
    return urllib.parse.urlunsplit((p.scheme, netloc, p.path, p.query, p.fragment))

def set_var(text, key, value):
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    if not pat.search(text):
        raise SystemExit(f"{key} not found in {ENV}; refusing to append blindly")
    return pat.sub(lambda _: f"{key}={value}", text, count=1)

def get_var(text, key):
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"{key} not found in {ENV}")
    return m.group(1).strip().strip('"').strip("'")

def main():
    if not os.path.exists(ENV):
        raise SystemExit(f"{ENV} does not exist")

    app_pw, ret_pw = gen(), gen()
    text = read(ENV)

    # 1. Rewrite the env file first, into a temp file, so a failure leaves the
    #    original untouched rather than half-written.
    new = text
    new = set_var(new, "SPLASHTRACK_APP_PASSWORD", app_pw)
    new = set_var(new, "SPLASHTRACK_RETENTION_PASSWORD", ret_pw)
    new = set_var(new, "DATABASE_URL", repoint(get_var(text, "DATABASE_URL"), app_pw))
    new = set_var(new, "DATABASE_MAINTENANCE_URL",
                  repoint(get_var(text, "DATABASE_MAINTENANCE_URL"), ret_pw))

    shutil.copy2(ENV, ENV + ".pre-rotation")
    os.chmod(ENV + ".pre-rotation", 0o600)

    # 2. Change the roles. SQL goes in on stdin, never as an argument.
    #    Dollar-quoting keeps the value out of any identifier parsing.
    sql = "".join(
        f"ALTER ROLE {role} WITH PASSWORD $rot${pw}$rot$;\n"
        for role, pw in ((APP, app_pw), (RET, ret_pw))
    )
    proc = subprocess.run(
        ["docker", "exec", "-i", PG, "psql", "-U", "splashtrack", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input=sql, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write("ALTER ROLE failed; env file NOT changed\n")
        sys.stderr.write(proc.stderr[-2000:])
        os.remove(ENV + ".pre-rotation")
        raise SystemExit(1)

    tmp = ENV + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(new)
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV)

    print(f"rotated: {APP}, {RET}")
    print(f"env rewritten: {ENV} (previous kept at {ENV}.pre-rotation, 0600)")
    print("next: restart the app container so it picks up the new URLs")

main()
