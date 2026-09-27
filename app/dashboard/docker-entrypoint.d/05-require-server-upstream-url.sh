#!/bin/sh
# Runs before the nginx entrypoint's 20-envsubst-on-templates.sh (scripts run in
# lexical order), so a bad AIKI_SERVER_UPSTREAM_URL fails here with a clear
# message instead of an nginx config error.
set -e

if [ -z "${AIKI_SERVER_UPSTREAM_URL:-}" ]; then
    echo >&2 "AIKI_SERVER_UPSTREAM_URL is required: set it to the Aiki server's address, e.g. http://server:9850"
    exit 1
fi

# If the URL has anything after host:port — even just a trailing slash — nginx
# rewrites the paths it forwards: /api/foo arrives at the server as /foo, and
# every call 404s. Refuse such urls.
authority_and_path="${AIKI_SERVER_UPSTREAM_URL#*://}"
case "$authority_and_path" in
    */*)
        echo >&2 "AIKI_SERVER_UPSTREAM_URL must not contain a path or trailing slash (got: $AIKI_SERVER_UPSTREAM_URL); use scheme://host:port, e.g. http://server:9850"
        exit 1
        ;;
esac
