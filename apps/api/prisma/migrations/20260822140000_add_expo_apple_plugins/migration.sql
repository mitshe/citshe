-- Add Expo (EAS) and Apple Developer stack plugin types.
ALTER TYPE "PluginType" ADD VALUE IF NOT EXISTS 'EXPO';
ALTER TYPE "PluginType" ADD VALUE IF NOT EXISTS 'APPLE_DEVELOPER';
