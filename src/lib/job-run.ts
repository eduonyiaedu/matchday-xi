import { prisma } from "@/lib/prisma";
import type { JobName } from "@/generated/prisma/enums";

/**
 * Wraps a cron job body with a JobRun log row, so the founder has something to check on the
 * admin page if automation seems stuck, instead of only finding out something broke via GitHub
 * Actions' own run history.
 */
export async function withJobRun<T>(jobName: JobName, fn: () => Promise<T>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { jobName } });
  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "SUCCESS",
        details: typeof result === "object" ? JSON.stringify(result) : String(result ?? ""),
      },
    });
    return result;
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "FAILURE",
        details: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
