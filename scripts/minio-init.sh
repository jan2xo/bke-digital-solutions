#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

if [ "${DEPLOYMENT_ENV:-}" = "production" ] && { [ "$S3_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ] || [ "$S3_SECRET_ACCESS_KEY" = "$MINIO_ROOT_PASSWORD" ]; }; then
  echo "S3 application credentials must be distinct from MinIO root credentials" >&2
  exit 1
fi

max_attempts=30
attempt=1
while ! mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "MinIO initialization failed: administrative readiness timeout" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

mc mb --ignore-existing "local/$S3_BUCKET" >/dev/null
mc anonymous set none "local/$S3_BUCKET" >/dev/null

policy_file=/tmp/bke-app-policy.json
printf '%s\n' "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Action\":[\"s3:GetBucketLocation\",\"s3:ListBucket\"],\"Effect\":\"Allow\",\"Resource\":[\"arn:aws:s3:::$S3_BUCKET\"]},{\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\"],\"Effect\":\"Allow\",\"Resource\":[\"arn:aws:s3:::$S3_BUCKET/*\"]}]}" > "$policy_file"

mc admin policy create local bke-app-storage "$policy_file" >/dev/null

mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc admin policy attach local bke-app-storage --user "$S3_ACCESS_KEY_ID" >/dev/null
policy_entities=$(mc admin policy entities local --user "$S3_ACCESS_KEY_ID" --json)
case "$policy_entities" in
  *'"policies":["bke-app-storage"]'*) ;;
  *) echo "MinIO initialization failed: application identity has unintended direct policy access" >&2; exit 1 ;;
esac

group_list=$(mc admin group list local --json)
case "$group_list" in
  *'"status":"success"'*) ;;
  *) echo "MinIO initialization failed: group authorization could not be inspected" >&2; exit 1 ;;
esac
group_names=
case "$group_list" in
  *'"groups":['*)
    group_marker='"groups":['
    group_names=${group_list#*"$group_marker"}
    group_names=${group_names%%]*}
    ;;
esac
old_ifs=$IFS
IFS=,
for group_name in $group_names; do
  group_name=${group_name#\"}
  group_name=${group_name%\"}
  [ -n "$group_name" ] || continue
  group_info=$(mc admin group info local "$group_name" --json)
  case "$group_info" in
    *'"status":"success"'*) ;;
    *) echo "MinIO initialization failed: group authorization could not be inspected" >&2; exit 1 ;;
  esac
  case "$group_info" in
    *"$S3_ACCESS_KEY_ID"*) echo "MinIO initialization failed: application identity belongs to an authorization-bearing group" >&2; exit 1 ;;
  esac
done
IFS=$old_ifs
mc alias set app http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc ls "app/$S3_BUCKET" >/dev/null
