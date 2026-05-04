.PHONY: help up down restart logs ps build rebuild migrate makemigration seed seed-novza shell-api shell-db backup test lint format prod-up prod-down prod-deploy prod-seed-novza clean

COMPOSE = docker compose
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Start all services (dev)
	$(COMPOSE) up -d

down: ## Stop all services
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

logs: ## Tail logs (service=api for one service)
	$(COMPOSE) logs -f $(service)

ps: ## List running services
	$(COMPOSE) ps

build: ## Build all images
	$(COMPOSE) build

rebuild: ## Rebuild all images without cache
	$(COMPOSE) build --no-cache

migrate: ## Run alembic migrations
	$(COMPOSE) exec api alembic upgrade head

makemigration: ## Create new alembic migration (msg="message")
	$(COMPOSE) exec api alembic revision --autogenerate -m "$(msg)"

seed: ## Seed initial Owner user
	$(COMPOSE) exec api python -m scripts.seed_owner

# Novza employees + departments + 9-18 shift from an Excel file.
# Usage:
#   make seed-novza xlsx=/abs/path/to/Tabel.xlsx
#   make seed-novza xlsx=./novza/Tabel.xlsx prefix=novza_ company=novza dry=1
seed-novza: ## Seed Novza employees from xlsx (xlsx=path, optional dry=1)
	@test -n "$(xlsx)" || (echo "❌ xlsx=path is required (e.g. xlsx=./novza/Tabel.xlsx)" && exit 2)
	@test -f "$(xlsx)" || (echo "❌ file not found: $(xlsx)" && exit 2)
	$(COMPOSE) cp "$(xlsx)" api:/tmp/novza.xlsx
	$(COMPOSE) exec api python -m scripts.seed_novza /tmp/novza.xlsx \
		--company $(or $(company),novza) \
		--branch "$(or $(branch),Asosiy filial)" \
		--hire-date $(or $(hire_date),2026-05-04) \
		--prefix $(or $(prefix),novza_) \
		$(if $(dry),--dry-run,)
	@if [ -z "$(dry)" ]; then \
		$(COMPOSE) cp api:/tmp/novza_credentials.csv "$(dir $(xlsx))novza_credentials.csv" && \
		echo "💾 Credentials → $(dir $(xlsx))novza_credentials.csv"; \
	fi

prod-seed-novza: ## Seed Novza employees in PRODUCTION (xlsx=path)
	@test -n "$(xlsx)" || (echo "❌ xlsx=path is required" && exit 2)
	@test -f "$(xlsx)" || (echo "❌ file not found: $(xlsx)" && exit 2)
	$(COMPOSE_PROD) cp "$(xlsx)" api:/tmp/novza.xlsx
	$(COMPOSE_PROD) exec api python -m scripts.seed_novza /tmp/novza.xlsx \
		--company $(or $(company),novza) \
		--branch "$(or $(branch),Asosiy filial)" \
		--hire-date $(or $(hire_date),2026-05-04) \
		--prefix $(or $(prefix),novza_) \
		$(if $(dry),--dry-run,)
	@if [ -z "$(dry)" ]; then \
		$(COMPOSE_PROD) cp api:/tmp/novza_credentials.csv "$(dir $(xlsx))novza_credentials.csv" && \
		echo "💾 Credentials → $(dir $(xlsx))novza_credentials.csv"; \
	fi

shell-api: ## Open shell in api container
	$(COMPOSE) exec api /bin/bash

shell-db: ## Open psql in postgres container
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-worktimepro} -d $${POSTGRES_DB:-worktimepro}

backup: ## Backup postgres + minio to ./backups/
	@bash backend/scripts/backup.sh

test: ## Run backend tests (creates worktimepro_test DB on first run)
	@$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-worktimepro} -d $${POSTGRES_DB:-worktimepro} -tAc "SELECT 1 FROM pg_database WHERE datname='$${POSTGRES_DB:-worktimepro}_test'" | grep -q 1 || \
		$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-worktimepro} -d $${POSTGRES_DB:-worktimepro} -c "CREATE DATABASE $${POSTGRES_DB:-worktimepro}_test"
	$(COMPOSE) exec -T api pytest

lint: ## Run linters
	$(COMPOSE) exec api ruff check .

format: ## Format backend code
	$(COMPOSE) exec api ruff format .

prod-up: ## Start prod stack (Traefik + SSL)
	$(COMPOSE_PROD) up -d

prod-down: ## Stop prod stack
	$(COMPOSE_PROD) down

clean: ## Remove containers, volumes (DESTRUCTIVE)
	$(COMPOSE) down -v
