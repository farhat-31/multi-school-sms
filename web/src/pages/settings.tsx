import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { syncToReplica } from "../data";
import { useWorkspace } from "../context";
import { useToast } from "../components/feedback";
import { Card, PageHeader, SimpleForm, fmt } from "../components/ui";

/** School Admin / Super Admin: the school's public profile. */
export function SchoolSettingsPage() {
  const { schoolId, school, reloadSchools } = useWorkspace();
  const toast = useToast();
  const v = (k: string) => (school?.[k] ? String(school[k]) : "");

  return (
    <>
      <PageHeader title="School profile" subtitle={`${fmt(school?.name)} · ${schoolId}`} />
      <div className="grid">
        <Card title="Details" subtitle="Shown across the app for everyone in this school.">
          <SimpleForm
            key={school?.id}
            submitLabel="Save changes"
            columns={2}
            fields={[
              { name: "name", label: "School name", required: true, defaultValue: v("name") },
              { name: "principal", label: "Principal", defaultValue: v("principal") },
              { name: "phone", label: "Phone", defaultValue: v("phone") },
              { name: "email", label: "Email", type: "email", defaultValue: v("email") },
              { name: "website", label: "Website", defaultValue: v("website") },
              { name: "address", label: "Address", type: "textarea", defaultValue: v("address") },
            ]}
            onSubmit={async (vals) => {
              await updateDoc(doc(db, "schools", schoolId!), vals);
              await syncToReplica(schoolId!, [{ collection: "_school", docId: schoolId! }]);
              await reloadSchools();
              toast("School profile saved");
              return "Saved. Reload to see the new name everywhere.";
            }}
          />
        </Card>
      </div>
    </>
  );
}
