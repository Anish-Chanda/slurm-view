#!/usr/bin/env bash

DEMO_USERS=(
  demo01
  demo02
  demo03
  demo04
  demo05
  demo06
)

DEMO_ACCOUNTS=(
  proteins
  chemistry
  climate
  cfd101
  ai
  ml101
)

DEMO_UIDS=(
  20001
  20002
  20003
  20004
  20005
  20006
)

demo_account_for() {
  local requested_user=$1
  local index

  for index in "${!DEMO_USERS[@]}"; do
    if [[ "${DEMO_USERS[$index]}" == "${requested_user}" ]]; then
      printf '%s\n' "${DEMO_ACCOUNTS[$index]}"
      return 0
    fi
  done

  return 1
}
