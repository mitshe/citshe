default:
    @just --list

dev: infra
    pnpm run dev

infra:
    docker compose -f docker/dev/docker-compose.yml up -d
    @echo "Waiting for databases to be ready..."
    @sleep 3
    @echo "Infrastructure ready!"
    @echo "  PostgreSQL: localhost:5432"
    @echo "  Redis:      localhost:6379"

infra-down:
    docker compose -f docker/dev/docker-compose.yml down

infra-logs:
    docker compose -f docker/dev/docker-compose.yml logs -f

run:
    docker run -d --name citshe -p 3000:3000 -p 3001:3001 -v citshe-data:/build/data -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/mitshe/citshe:latest
    @echo "citshe is starting..."
    @echo "  Frontend: http://localhost:3000"
    @echo "  API:      http://localhost:3001"

stop:
    docker stop citshe && docker rm citshe

executor-build:
    docker build --target full -t ghcr.io/mitshe/citshe-executor:latest -f apps/api/docker/executor/Dockerfile apps/api/docker/executor/

executor-build-lite:
    docker build --target lite -t ghcr.io/mitshe/citshe-executor:lite -f apps/api/docker/executor/Dockerfile apps/api/docker/executor/

light-build:
    docker build -t ghcr.io/mitshe/citshe:latest -f docker/light/Dockerfile .

light:
    docker compose -f docker/light/docker-compose.yml up

light-up:
    docker compose -f docker/light/docker-compose.yml up -d

light-down:
    docker compose -f docker/light/docker-compose.yml down

light-logs:
    docker logs -f citshe

prod:
    docker compose -f docker/prod/docker-compose.yml --env-file .env up -d --build

prod-up:
    docker compose -f docker/prod/docker-compose.yml --env-file .env up -d

prod-down:
    docker compose -f docker/prod/docker-compose.yml --env-file .env down

prod-logs:
    docker compose -f docker/prod/docker-compose.yml logs -f --tail 50

prod-restart:
    docker compose -f docker/prod/docker-compose.yml --env-file .env restart

install:
    pnpm install

build:
    pnpm run build

build-api:
    pnpm --filter @citshe/api run build

build-web:
    pnpm --filter @citshe/web run build

build-types:
    pnpm --filter @citshe/types run build

clean:
    rm -rf apps/web/.next apps/api/dist packages/types/dist node_modules/.cache

db-generate:
    pnpm --filter @citshe/api run db:generate

db-migrate:
    pnpm --filter @citshe/api run db:migrate

db-migrate-deploy:
    pnpm --filter @citshe/api run db:migrate:deploy

db-push:
    pnpm --filter @citshe/api run db:push

db-reset:
    pnpm --filter @citshe/api run db:reset

db-studio:
    pnpm --filter @citshe/api run db:studio

test:
    pnpm test

test-api:
    pnpm --filter @citshe/api test

test-web:
    pnpm --filter @citshe/web test

lint:
    pnpm run lint

typecheck:
    pnpm run typecheck

check: lint typecheck test

setup: install db-generate
    @echo "Setup complete! Run 'just dev' to start."

env-setup:
    @if [ ! -f .env ]; then cp .env.example .env && echo "Created .env"; fi
