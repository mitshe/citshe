-- CreateTable
CREATE TABLE "cli_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashed_key" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cli_tokens_user_id_idx" ON "cli_tokens"("user_id");

-- CreateIndex
CREATE INDEX "cli_tokens_hashed_key_idx" ON "cli_tokens"("hashed_key");

-- AddForeignKey
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
