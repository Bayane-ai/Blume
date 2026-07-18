export default function MatchesRedirect() {
  return null;
}

export function getServerSideProps() {
  return { redirect: { destination: "/", permanent: true } };
}
