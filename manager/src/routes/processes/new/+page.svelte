<script>
	import { enhance } from '$app/forms';
	import {
		Container,
		Row,
		Col,
		Form,
		InputGroup,
		Accordion,
		Button,
		Tooltip,
		FormGroup,
		AccordionItem,
		Label,
		Input,
		InputGroupText
	} from 'sveltestrap';
</script>

<Container style="max-width: 800px; padding-top: 24px; padding-bottom: 24px;">
	<header style="padding-bottom: 1rem">
		<h2>New process</h2>
	</header>

	<Container>
		<Row>
			<Col>
				<form
					id="new-sm"
					method="POST"
					use:enhance={() => {
						return ({ update }) => update({ reset: false });
					}}
				>
					<FormGroup>
						<FormGroup>
							<Row>
								<Col>
									<Label sm={2}>Resources:</Label>
								</Col>
								<Col sm={10}>
									<InputGroup>
										<Input id="resources" name="resources" type="textarea" form="new-sm" />
										<Tooltip target="resources-tt">One resource URL per line</Tooltip>
										<InputGroupText id="resources-tt">?</InputGroupText>
									</InputGroup>
								</Col>
							</Row>
						</FormGroup>
						<FormGroup>
							<Row>
								<Col sm={1}>
									<Label>Email:</Label>
								</Col>
								<Col sm={{ size: 6, offset: 1 }}>
									<InputGroup>
										<Input name="email" />
										<Tooltip target="email-tt"
											>We'll send you an email whenever the semantic measure calculation process
											enters a new stage. No SPAM</Tooltip
										>
										<InputGroupText id="email-tt">?</InputGroupText>
									</InputGroup>
								</Col>
							</Row>
						</FormGroup>
					</FormGroup>

					<FormGroup>
						<Col sm={10}>
							<Button color="primary" type="submit">Submit</Button>
						</Col>
					</FormGroup>
				</form>
			</Col>
		</Row>
	</Container>
</Container>
