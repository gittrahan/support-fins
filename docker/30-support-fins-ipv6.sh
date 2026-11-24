#!/bin/sh
# Listen on IPv6 only where the kernel has it (issue #494). nginx refuses to start
# when told to listen on [::] on a host with IPv6 turned off, so nginx.conf no
# longer hard-codes it: this writes the IPv6 listen line to a /tmp include
# (the one path a read-only container may write) when /proc/net/if_inet6 is there,
# and removes it otherwise. SUPPORT_FINS_IPV6=off forces IPv4 only.
set -eu

conf=/tmp/support-fins-listen-ipv6.conf
rm -f "$conf"

if [ "${SUPPORT_FINS_IPV6:-auto}" = off ]; then
  echo "$0: SUPPORT_FINS_IPV6=off, listening on IPv4 only"
elif [ -f /proc/net/if_inet6 ]; then
  echo 'listen [::]:8080;' > "$conf"
else
  echo "$0: no IPv6 on this host, listening on IPv4 only"
fi
