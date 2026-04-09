.PHONY: help validate register test clean

SHELL := /bin/bash

# Configuration
PROVIDER_CONFIG := config/provider.yml
CI_CONFIG := config/ci.yml
SCRIPTS_DIR := scripts

help: ## Show available commands
	@echo ""
	@echo "Codesphere Landscape Provider — Available Commands"
	@echo "=================================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

validate: ## Validate provider.yml and ci.yml
	@bash $(SCRIPTS_DIR)/validate.sh

register: validate ## Register the provider with Codesphere (validates first)
	@bash $(SCRIPTS_DIR)/register.sh

test: validate ## Deploy a test instance and run smoke tests
	@bash $(SCRIPTS_DIR)/test-provider.sh

clean: ## Remove generated config files (keeps examples)
	@echo "Cleaning generated configs..."
	@rm -f $(PROVIDER_CONFIG) $(CI_CONFIG)
	@echo "Done."

start-api-backend: ## Start the API backend for local development
	STALWART_API_URL=http://localhost:1080 STALWART_ADMIN_TOKEN="admin:localdev123" STALWART_IMAP_HOST=localhost STALWART_SMTP_HOST=localhost STALWART_IMAP_PORT=1993 STALWART_SMTP_PORT=1587 PORT=9090 node server.js

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
	@echo "✅ Done. Check inbox at $(JMAP_TO_EMAIL) or open http://localhost:1080/login"