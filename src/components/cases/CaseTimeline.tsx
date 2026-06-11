import { formatFullDate } from "@/lib/caseflow/utils/date";

interface ProgressItem {
  id: string;
  progress_date: string | null;
  content: string | null;
  result: string | null;
  notification: string | null;
  is_new: boolean;
}

interface CaseTimelineProps {
  progress: ProgressItem[];
}

export function CaseTimeline({ progress }: CaseTimelineProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        진행내역 ({progress.length})
      </h2>

      {progress.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">진행내역이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="py-2.5 px-3 text-center font-semibold text-gray-700 whitespace-nowrap w-28">
                  일자
                </th>
                <th className="py-2.5 px-3 text-left font-semibold text-gray-700">내용</th>
                <th className="py-2.5 px-3 text-center font-semibold text-gray-700 whitespace-nowrap w-36">
                  결과
                </th>
              </tr>
            </thead>
            <tbody>
              {progress.map((item) => {
                const isApproval = item.content === "변제계획인가결정" || item.content === "변제계획인가결정공고";
                const isCommencement = item.content === "개인회생절차개시결정";
                const isKeyEvent = isApproval || isCommencement;

                const rowClass = isApproval
                  ? "border-b border-purple-200 bg-purple-50"
                  : isCommencement
                    ? "border-b border-blue-200 bg-blue-50"
                    : "border-b border-gray-100 hover:bg-gray-50";

                const contentClass = isApproval
                  ? "font-semibold text-purple-800"
                  : isCommencement
                    ? "font-semibold text-blue-800"
                    : "text-gray-900";

                return (
                  <tr key={item.id} className={rowClass}>
                    <td className="py-2.5 px-3 text-center text-gray-600 whitespace-nowrap">
                      {item.progress_date ? formatFullDate(item.progress_date) : "-"}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={contentClass}>{item.content || "-"}</span>
                      {item.is_new && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">NEW</span>
                      )}
                      {isKeyEvent && (
                        <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isApproval ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {isApproval ? "인가결정" : "개시결정"}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {item.result ? (
                        <span className="text-orange-600 font-medium">{item.result}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
