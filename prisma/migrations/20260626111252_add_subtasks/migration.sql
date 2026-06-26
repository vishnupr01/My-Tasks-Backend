-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "parentId" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
