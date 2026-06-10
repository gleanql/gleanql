import { glean } from "~/graph";

// A DESTRUCTURED `.map` element (`({ title, handle: slug }) => …`): each bound name
// is a field read off the element, and a renamed binding reads the ORIGINAL field.
export default function ListRoute({ params }: { params: { handle: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return (
    <ul>
      {products.map(({ title, handle: slug }) => (
        <li key={slug}>{title}</li>
      ))}
    </ul>
  );
}
