import { DAILY_QUESTION_LIMIT } from "./config";

const USAGE_STORAGE_KEY = "jarvis_vo_daily_usage";

interface DailyUsageRecord {
  dateKey: string;
  questionCount: number;
}

function getTodayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readDailyUsage(): Promise<DailyUsageRecord> {
  const storedValue = await chrome.storage.local.get(USAGE_STORAGE_KEY);
  const storedRecord = storedValue[USAGE_STORAGE_KEY] as
    | DailyUsageRecord
    | undefined;
  const todayDateKey = getTodayDateKey();

  if (!storedRecord || storedRecord.dateKey !== todayDateKey) {
    return { dateKey: todayDateKey, questionCount: 0 };
  }

  return storedRecord;
}

export async function getRemainingQuestionsToday(): Promise<number> {
  const usageRecord = await readDailyUsage();
  return Math.max(0, DAILY_QUESTION_LIMIT - usageRecord.questionCount);
}

export async function assertCanAskQuestionToday(): Promise<void> {
  const remainingQuestions = await getRemainingQuestionsToday();
  if (remainingQuestions <= 0) {
    throw new Error(
      `Daily limit reached (${DAILY_QUESTION_LIMIT}/day). Try again tomorrow.`
    );
  }
}

export async function recordQuestionAsked(): Promise<number> {
  const usageRecord = await readDailyUsage();
  const updatedRecord: DailyUsageRecord = {
    dateKey: usageRecord.dateKey,
    questionCount: usageRecord.questionCount + 1,
  };

  await chrome.storage.local.set({
    [USAGE_STORAGE_KEY]: updatedRecord,
  });

  return Math.max(0, DAILY_QUESTION_LIMIT - updatedRecord.questionCount);
}
