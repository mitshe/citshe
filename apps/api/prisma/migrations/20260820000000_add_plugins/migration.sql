-- Stack plugins (Cloudflare / Vercel / Neon / Google Ads / VPS). The Plugin
-- model was previously only present in schema.prisma (applied to dev via
-- `db push`); this migration adds the missing DDL so a fresh database has the
-- PluginType enum and plugins table before later migrations ALTER the enum.

-- CreateEnum
CREATE TYPE "PluginType" AS ENUM ('CLOUDFLARE', 'VERCEL', 'NEON', 'GOOGLE_ADS', 'VPS');

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "PluginType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "label" TEXT,
    "config_encrypted" BYTEA NOT NULL,
    "config_iv" BYTEA NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugins_organization_id_type_key" ON "plugins"("organization_id", "type");

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
