-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('PR', 'DIRECT_PUSH');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "delivery_mode" "DeliveryMode" NOT NULL DEFAULT 'PR';
