#!/bin/sh
# Reset git commit author

git rebase -i --root -x "git commit --amend --reset-author --no-edit"