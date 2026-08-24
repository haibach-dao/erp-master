# Convenience targets for local development.
# Windows without `make`: run the underlying `docker compose ...` commands directly.

.PHONY: up down logs ps restart nuke

up: ## Start local infra (postgres, redis, minio, mailpit)
	docker compose up -d

down: ## Stop infra (keep volumes)
	docker compose down

logs: ## Tail infra logs
	docker compose logs -f

ps: ## Show infra status
	docker compose ps

restart: down up ## Restart infra

nuke: ## Stop infra and DELETE volumes (data loss)
	docker compose down -v
