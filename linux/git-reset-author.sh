#!/bin/sh
# Reset git commit author

git rebase --root -x "git commit --amend --reset-author --no-edit"