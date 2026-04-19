FROM redis:7-alpine

RUN apk add --no-cache gettext

COPY redis.conf /etc/redis/redis.conf
COPY redis.acl.template /etc/redis/redis.acl.template
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
