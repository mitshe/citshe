-- Add Stripe (payments) and Clerk (auth) stack plugin types.
ALTER TYPE "PluginType" ADD VALUE IF NOT EXISTS 'STRIPE';
ALTER TYPE "PluginType" ADD VALUE IF NOT EXISTS 'CLERK';
