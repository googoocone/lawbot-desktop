// 내 사건 목록의 필터/정렬/검색/스크롤 상태.
// 상세 페이지에 들어가면 목록 컴포넌트가 언마운트되므로,
// 돌아왔을 때 그대로 복원되도록 모듈 레벨에 보관한다. (앱 재시작 시 초기화)
export interface ListUiCache {
  work: "" | "urgent" | "extension" | "nocrawl";
  sortMode: "seq" | "deadline";
  stageFilter: string;
  deadlineStatusFilter: string;
  searchQuery: string;
  docTypeFilter: string;
  receivedDateSort: "asc" | "desc" | "";
  stageSortDir: "asc" | "desc" | "";
  indexSort: "asc" | "desc";
  scrollTop: number | null;
}

export const listUiCache: ListUiCache = {
  work: "",
  sortMode: "seq",
  stageFilter: "",
  deadlineStatusFilter: "",
  searchQuery: "",
  docTypeFilter: "",
  receivedDateSort: "",
  stageSortDir: "",
  indexSort: "asc",
  scrollTop: null,
};
