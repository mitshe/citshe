-- CreateTable
CREATE TABLE "cli_auth_requests" (
    "id" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "user_id" TEXT,
    "token" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_auth_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cli_auth_requests_device_code_key" ON "cli_auth_requests"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "cli_auth_requests_user_code_key" ON "cli_auth_requests"("user_code");

-- CreateIndex
CREATE INDEX "cli_auth_requests_user_code_idx" ON "cli_auth_requests"("user_code");
