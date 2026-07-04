/** Encart d'information ou d'erreur, toujours posé et sans couleur criarde. */
export default function MessageCalme({ children }) {
  return (
    <div className="message-calme" role="status">
      {children}
    </div>
  );
}
