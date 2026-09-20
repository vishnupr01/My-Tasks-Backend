-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('TEXT', 'CODE');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "kind" "ChannelKind" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "CodeDocument" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT 'main',
    "language" TEXT NOT NULL DEFAULT 'javascript',
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "CodeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeDocument_channelId_path_key" ON "CodeDocument"("channelId", "path");

-- AddForeignKey
ALTER TABLE "CodeDocument" ADD CONSTRAINT "CodeDocument_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeDocument" ADD CONSTRAINT "CodeDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
