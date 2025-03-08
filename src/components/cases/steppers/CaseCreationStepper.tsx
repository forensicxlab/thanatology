import React, { useState } from "react";
import Box from "@mui/material/Box";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import NewCaseForm from "../forms/NewCaseForm";
import MultipleEvidenceForm from "../../evidences/forms/MultipleEvidenceForm";
import FinalSummary from "./FinalSummary";
import { Evidence } from "../../../dbutils/types";
import { createCaseAndEvidence } from "../../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";
import { useNavigate } from "react-router";

const steps = ["Case information", "Evidence(s)", "Summary"];

interface CaseCreationStepperProps {
  database: Database | null;
}

const CaseCreationStepper: React.FC<CaseCreationStepperProps> = ({
  database,
}) => {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [skipped, setSkipped] = useState(new Set<number>());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);

  // --------------- CASE FIELDS ------------------
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedCollaborators, setSelectedCollaborators] = useState<string[]>(
    [],
  );
  const availableUsernames = ["alice", "bob", "charlie", "dave"]; // TODO: fetch from database

  // ---------------- EVIDENCE FIELDS ------------------
  const defaultEmptyEvidence: Evidence = {
    id: 0,
    name: "",
    type: "Disk image",
    path: "",
    description: "",
    case_id: 0,
    status: 0,
  };

  const [evidences, setEvidences] = React.useState<Evidence[]>([
    { ...defaultEmptyEvidence },
  ]);

  // Validation functions
  const isCaseInfoValid = (): boolean =>
    name.trim() !== "" && description.trim() !== "";

  const isEvidenceComplete = (evidence: Evidence): boolean =>
    evidence.name.trim() !== "" &&
    evidence.type.trim() !== "" &&
    evidence.description.trim() !== "";

  const isEvidenceStepValid = (): boolean =>
    evidences.every(isEvidenceComplete);

  const isStepOptional = (step: number) => step === 1;
  const isStepSkipped = (step: number) => skipped.has(step);

  const handleNext = () => {
    let newSkipped = skipped;
    if (isStepSkipped(activeStep)) {
      newSkipped = new Set(newSkipped.values());
      newSkipped.delete(activeStep);
    }
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    setSkipped(newSkipped);
  };

  const handleBack = () => {
    if (activeStep === steps.length - 1 && skipped.has(1)) {
      setActiveStep(1);
    } else {
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
    setEvidences([]);
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    setSkipped((prevSkipped) => {
      const newSkipped = new Set(prevSkipped.values());
      newSkipped.add(activeStep);
      return newSkipped;
    });
  };

  const handleReset = () => {
    setActiveStep(0);
  };

  // This async function will be triggered on the last step to create the case in the database.
  const handleFinish = async () => {
    setIsSubmitting(true);
    try {
      createCaseAndEvidence(
        {
          id: 0,
          name,
          description,
          collaborators: [1],
        },
        evidences,
        database,
      )
        .then(() => {
          setCreatedCaseId(result);
          setActiveStep(steps.length);
        })
        .catch((error: any) => {
          console.log(error);
          // display_message("warning", error);
        });
      let result = "1";
    } catch (error) {
      console.error("Error creating case:", error);
      // TODO add error handling (e.g. display a message to the user).
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewCase = () => {
    navigate(`/cases/${createdCaseId}`);
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
            Case created with success.
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "row", pt: 2 }}>
            <Box sx={{ flex: "1 1 auto" }} />
            {createdCaseId ? (
              <Button onClick={handleViewCase}>View Created Case</Button>
            ) : (
              <Button onClick={handleReset}>Reset</Button>
            )}
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

          {activeStep === 2 && (
            <FinalSummary
              name={name}
              description={description}
              selectedCollaborators={selectedCollaborators}
              evidences={evidences}
            />
          )}

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
            <Button
              onClick={
                activeStep === steps.length - 1 ? handleFinish : handleNext
              }
              disabled={
                (activeStep === 0 && !isCaseInfoValid()) ||
                (activeStep === 1 && !isEvidenceStepValid()) ||
                isSubmitting
              }
            >
              {activeStep === steps.length - 1
                ? isSubmitting
                  ? "Submitting..."
                  : "Finish"
                : "Next"}
            </Button>
          </Box>
        </React.Fragment>
      )}
    </Box>
  );
};

export default CaseCreationStepper;
