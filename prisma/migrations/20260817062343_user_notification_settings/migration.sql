-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationSoundEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
