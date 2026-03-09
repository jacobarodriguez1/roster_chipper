-- DropIndex
DROP INDEX "Issue_stagedRowId_key";

-- CreateIndex
CREATE INDEX "Issue_stagedRowId_idx" ON "Issue"("stagedRowId");
