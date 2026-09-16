import { redirect } from "next/navigation";

/** History moved to be a subsection of Fixtures — kept as a redirect so old links (e.g. the
 * "scoring is in" push notification's url) still land somewhere real. */
export default function HistoryRedirectPage() {
  redirect("/fixtures/history");
}
