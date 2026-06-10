import { redirect } from "react-router";

export function loader() {
  return redirect("/collections/all");
}

export default function Home() {
  return null;
}
