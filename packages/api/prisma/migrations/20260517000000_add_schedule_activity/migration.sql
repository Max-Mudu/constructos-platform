-- CreateTable
CREATE TABLE "schedule_activities" (
    "id"             TEXT NOT NULL,
    "scheduleTaskId" TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "type"           TEXT NOT NULL,
    "oldValue"       TEXT,
    "newValue"       TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_activities_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "schedule_activities"
    ADD CONSTRAINT "schedule_activities_scheduleTaskId_fkey"
    FOREIGN KEY ("scheduleTaskId")
    REFERENCES "schedule_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_activities"
    ADD CONSTRAINT "schedule_activities_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
