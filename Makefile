.PHONY: help validate test clean start-api-backend send-mail

SHELL := /bin/bash

SCRIPTS_DIR := scripts

help: ## Show available commands
	@echo ""
	@echo "Stalwart Managed Service Provider — Available Commands"
	@echo "======================================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

validate: ## Validate provider.yml
	@bash $(SCRIPTS_DIR)/validate.sh

test: validate ## Run smoke tests (validates first)
	@bash $(SCRIPTS_DIR)/test-provider.sh

start-api-backend: ## Start the REST backend for local development
	cd src && \
	STALWART_API_URL=http://localhost:1080 \
	STALWART_ADMIN_TOKEN="admin:localdev123" \
	STALWART_IMAP_HOST=localhost \
	STALWART_SMTP_HOST=localhost \
	STALWART_IMAP_PORT=1993 \
	STALWART_SMTP_PORT=1587 \
	PORT=9090 \
	node server.js

# JMAP test email configuration (override with env vars)
JMAP_URL ?= http://localhost:1080/jmap/
JMAP_USER ?= jd
JMAP_PASS ?= jd
JMAP_ACCOUNT_ID ?= j
JMAP_IDENTITY_ID ?= b
JMAP_DRAFTS_ID ?= d
JMAP_FROM_NAME ?= JD
JMAP_FROM_EMAIL ?= jd@codesphere.com
JMAP_TO_NAME ?= Test
JMAP_TO_EMAIL ?= jd@codesphere.com
JMAP_SUBJECT ?= Test from make send-mail
JMAP_BODY ?= This email was sent via JMAP using make send-mail.

send-mail: ## Send a test email via JMAP (override with JMAP_TO_EMAIL=... etc.)
	@echo "Sending email from $(JMAP_FROM_EMAIL) to $(JMAP_TO_EMAIL)..."
	@curl -s $(JMAP_URL) \
		-u '$(JMAP_USER):$(JMAP_PASS)' \
		-H 'Content-Type: application/json' \
		-d '{"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],"methodCalls":[["Email/set",{"accountId":"$(JMAP_ACCOUNT_ID)","create":{"draft1":{"mailboxIds":{"$(JMAP_DRAFTS_ID)":true},"from":[{"name":"$(JMAP_FROM_NAME)","email":"$(JMAP_FROM_EMAIL)"}],"to":[{"name":"$(JMAP_TO_NAME)","email":"$(JMAP_TO_EMAIL)"}],"subject":"$(JMAP_SUBJECT)","textBody":[{"partId":"body","type":"text/plain"}],"bodyValues":{"body":{"value":"$(JMAP_BODY)","isEncodingProblem":false}}}}},"c1"],["EmailSubmission/set",{"accountId":"$(JMAP_ACCOUNT_ID)","create":{"sub1":{"identityId":"$(JMAP_IDENTITY_ID)","emailId":"#draft1"}}},"c2"]]}' | python3 -m json.tool
	@echo ""
	@echo "Done. Check inbox at $(JMAP_TO_EMAIL) or open http://localhost:1080/login"
