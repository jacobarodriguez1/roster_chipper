-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "StagedRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "brigadeNumber" TEXT NOT NULL,
    "schoolOrUnit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "teamNumber" TEXT NOT NULL,
    "cadetLastName" TEXT NOT NULL,
    "cadetFirstName" TEXT NOT NULL,
    "cadetRank" TEXT NOT NULL,
    "cadetGender" TEXT NOT NULL,
    "cadetGrade" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StagedRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CadetIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "canonicalLastName" TEXT NOT NULL,
    "canonicalFirstName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "isMerged" BOOLEAN NOT NULL DEFAULT false,
    "mergedIntoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CadetIdentity_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CadetIdentity_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "CadetIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "brigadeNumber" TEXT NOT NULL,
    "schoolOrUnit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "teamNumber" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "cadetIdentityId" TEXT NOT NULL,
    "stagedRowId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMembership_cadetIdentityId_fkey" FOREIGN KEY ("cadetIdentityId") REFERENCES "CadetIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMembership_stagedRowId_fkey" FOREIGN KEY ("stagedRowId") REFERENCES "StagedRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "stagedRowId" TEXT,
    "cadetIdentityId" TEXT,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "detailsJson" TEXT,
    "overrideReason" TEXT,
    "brigadeNumber" TEXT,
    "category" TEXT,
    "division" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_stagedRowId_fkey" FOREIGN KEY ("stagedRowId") REFERENCES "StagedRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_cadetIdentityId_fkey" FOREIGN KEY ("cadetIdentityId") REFERENCES "CadetIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IssueResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueResolution_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "defaultDuration" INTEGER NOT NULL,
    "padCount" INTEGER NOT NULL,
    "groupingWeight" INTEGER NOT NULL DEFAULT 70,
    "efficiencyWeight" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleConfig_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CategoryConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleConfigId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "division" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategoryConfig_scheduleConfigId_fkey" FOREIGN KEY ("scheduleConfigId") REFERENCES "ScheduleConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePad" TEXT,
    "subLane" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "laneOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pad_scheduleConfigId_fkey" FOREIGN KEY ("scheduleConfigId") REFERENCES "ScheduleConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PadBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "padId" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PadBlock_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "scheduleConfigId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleVersion_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleVersion_scheduleConfigId_fkey" FOREIGN KEY ("scheduleConfigId") REFERENCES "ScheduleConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleVersionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "padId" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleSlot_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleSlot_padId_fkey" FOREIGN KEY ("padId") REFERENCES "Pad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StagedRow_uploadId_idx" ON "StagedRow"("uploadId");

-- CreateIndex
CREATE INDEX "StagedRow_uploadId_normalizedName_idx" ON "StagedRow"("uploadId", "normalizedName");

-- CreateIndex
CREATE INDEX "CadetIdentity_uploadId_canonicalKey_idx" ON "CadetIdentity"("uploadId", "canonicalKey");

-- CreateIndex
CREATE INDEX "Team_uploadId_category_division_idx" ON "Team"("uploadId", "category", "division");

-- CreateIndex
CREATE UNIQUE INDEX "Team_uploadId_teamKey_key" ON "Team"("uploadId", "teamKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_stagedRowId_key" ON "TeamMembership"("stagedRowId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_cadetIdentityId_idx" ON "TeamMembership"("cadetIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_stagedRowId_key" ON "Issue"("stagedRowId");

-- CreateIndex
CREATE INDEX "Issue_uploadId_severity_status_idx" ON "Issue"("uploadId", "severity", "status");

-- CreateIndex
CREATE INDEX "Issue_uploadId_type_idx" ON "Issue"("uploadId", "type");

-- CreateIndex
CREATE INDEX "IssueResolution_issueId_idx" ON "IssueResolution"("issueId");

-- CreateIndex
CREATE INDEX "ScheduleConfig_uploadId_createdAt_idx" ON "ScheduleConfig"("uploadId", "createdAt");

-- CreateIndex
CREATE INDEX "CategoryConfig_scheduleConfigId_category_division_idx" ON "CategoryConfig"("scheduleConfigId", "category", "division");

-- CreateIndex
CREATE INDEX "Pad_scheduleConfigId_laneOrder_idx" ON "Pad"("scheduleConfigId", "laneOrder");

-- CreateIndex
CREATE INDEX "PadBlock_padId_startMin_idx" ON "PadBlock"("padId", "startMin");

-- CreateIndex
CREATE INDEX "ScheduleVersion_uploadId_createdAt_idx" ON "ScheduleVersion"("uploadId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleSlot_scheduleVersionId_padId_startMin_idx" ON "ScheduleSlot"("scheduleVersionId", "padId", "startMin");

-- CreateIndex
CREATE INDEX "ScheduleSlot_scheduleVersionId_teamId_idx" ON "ScheduleSlot"("scheduleVersionId", "teamId");
