import * as React from "react";
import Box from "@mui/material/Box";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import NewCaseForm from "../forms/NewCaseForm";
import MultipleEvidenceForm from "../../evidences/forms/MultipleEvidenceForm";
import { EvidenceData } from "../../../dbutils/types";

const steps = ["Case information", "Evidence(s)", "Processing", "Summary"];

export default function CaseCreationStepper() {
  const [activeStep, setActiveStep] = React.useState(0);
  const [skipped, setSkipped] = React.useState(new Set<number>());

  // --------------- CASE FIELDS ------------------
  const [name, setName] = React.useState<string>("");
  const [description, setDescription] = React.useState<string>("");
  const [selectedCollaborators, setSelectedCollaborators] = React.useState<
    string[]
  >([]);
  const availableUsernames = ["alice", "bob", "charlie", "dave"]; // TODO: fetch from database

  // ---------------- EVIDENCE FIELDS------------------

  const defaultEmptyEvidence: EvidenceData = {
    evidenceName: "",
    evidenceType: "Disk image",
    evidenceDescription: "",
    sealNumber: "",
    sealingDateTime: "",
    sealingLocation: "",
    sealingPerson: "",
    sealReason: "",
    sealReferenceFile: null,
  };

  const [evidences, setEvidences] = React.useState<EvidenceData[]>([
    { ...defaultEmptyEvidence },
  ]);

  const isStepOptional = (step: number) => {
    return step === 1;
  };

  const isStepSkipped = (step: number) => {
    return skipped.has(step);
  };

  const handleNext = () => {
    let newSkipped = skipped;
    if (isStepSkipped(activeStep)) {
      newSkipped = new Set(newSkipped.values());
      newSkipped.delete(activeStep);
    } else {
      if (activeStep === 1) {
        // The user was on the evidence step and did not skip it.
        // You might add validations or other logic here.
      }
    }
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    setSkipped(newSkipped);
  };

  const handleBack = () => {
    // Special behavior: if on the last step (Summary) and both steps 1 and 2 were skipped,
    // take the user back to step 1 (so they have a chance to fill in evidence)
    if (activeStep === steps.length - 1 && skipped.has(1) && skipped.has(2)) {
      setActiveStep(1);
    } else {
      // Otherwise, go back to the previous non-skipped step.
      let newStep = activeStep - 1;
      while (newStep > 0 && skipped.has(newStep)) {
        newStep--;
      }
      setActiveStep(newStep);
    }
  };

  const handleSkip = () => {
    if (!isStepOptional(activeStep)) {
      throw new Error("You can't skip a step that isn't optional.");
    }

    // When skipping step 1 (Evidence(s)), also mark step 2 (Processing) as skipped.
    if (activeStep === 1) {
      setActiveStep((prevActiveStep) => prevActiveStep + 2);
      setSkipped((prevSkipped) => {
        const newSkipped = new Set(prevSkipped.values());
        newSkipped.add(1);
        newSkipped.add(2);
        return newSkipped;
      });
    } else {
      setActiveStep((prevActiveStep) => prevActiveStep + 1);
      setSkipped((prevSkipped) => {
        const newSkipped = new Set(prevSkipped.values());
        newSkipped.add(activeStep);
        return newSkipped;
      });
    }
  };

  const handleReset = () => {
    setActiveStep(0);
  };

  return (
    <Box sx={{ width: "100%" }}>
      <Stepper activeStep={activeStep}>
        {steps.map((label, index) => {
          const stepProps: { completed?: boolean } = {};
          const labelProps: { optional?: React.ReactNode } = {};
          if (isStepOptional(index)) {
            labelProps.optional = (
              <Typography variant="caption">Optional</Typography>
            );
          }
          if (isStepSkipped(index)) {
            stepProps.completed = false;
          }
          return (
            <Step key={label} {...stepProps}>
              <StepLabel {...labelProps}>{label}</StepLabel>
            </Step>
          );
        })}
      </Stepper>
      {activeStep === steps.length ? (
        <React.Fragment>
          <Typography sx={{ mt: 2, mb: 1 }}>
            All steps completed - you&apos;re finished
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "row", pt: 2 }}>
            <Box sx={{ flex: "1 1 auto" }} />
            <Button onClick={handleReset}>Reset</Button>
          </Box>
        </React.Fragment>
      ) : (
        <React.Fragment>
          {activeStep === 0 && (
            <NewCaseForm
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              selectedCollaborators={selectedCollaborators}
              setSelectedCollaborators={setSelectedCollaborators}
              availableCollaborators={availableUsernames}
            />
          )}

          {activeStep === 1 && (
            <MultipleEvidenceForm
              evidences={evidences}
              setEvidences={setEvidences}
              defaultEmptyEvidence={defaultEmptyEvidence}
            />
          )}

          {activeStep === 2 && <>Evidence Processing here</>}

          <Box sx={{ display: "flex", flexDirection: "row", pt: 2 }}>
            <Button
              color="inherit"
              disabled={activeStep === 0}
              onClick={handleBack}
              sx={{ mr: 1 }}
            >
              Back
            </Button>
            <Box sx={{ flex: "1 1 auto" }} />
            {isStepOptional(activeStep) && (
              <Button color="inherit" onClick={handleSkip} sx={{ mr: 1 }}>
                Load evidence(s) later
              </Button>
            )}
            <Button onClick={handleNext}>
              {activeStep === steps.length - 1 ? "Finish" : "Next"}
            </Button>
          </Box>
        </React.Fragment>
      )}
    </Box>
  );
}
